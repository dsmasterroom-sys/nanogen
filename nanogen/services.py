import os
import io
import base64
from google import genai
from google.genai import types
from google.genai import errors
from PIL import Image

def get_ai_client():
    # Nanobanana (Image Gen) uses GEMINI_API_KEY
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not found in .env")
    
    # Increase timeout to 10 minutes (600 seconds)
    return genai.Client(api_key=api_key, http_options={'timeout': 600000})


def process_reference_image(img_str):
    """
    Decodes a base64 image string, resizes it to max 1024x1024,
    and returns bytes and mime_type.
    """
    if not img_str.startswith('data:'):
        return None, None
        
    try:
        header, data = img_str.split(',', 1)
        mime_type = header.split(':')[1].split(';')[0]
        image_bytes = base64.b64decode(data)
        
        # Open with PIL
        img = Image.open(io.BytesIO(image_bytes))
        
        # Resize if side is > 1024
        max_size = 1024
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
            
            # Save back to bytes
            buffer = io.BytesIO()
            # Convert to RGB if necessary for JPEG, or keep original format if supported
            # For simplicity and size reduction, let's use JPEG for photos
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            
            img.save(buffer, format="JPEG", quality=85)
            buffer.seek(0)
            return buffer.getvalue(), "image/jpeg"
        
        return image_bytes, mime_type
        
    except Exception as e:
        print(f"Error processing reference image: {e}")
        return None, None

def generate_image_with_gemini(prompt, config, reference_images=None, mask_image=None):
    """
    Generates an image using Gemini 3 Pro.
    
    Args:
        prompt (str): The text prompt.
        config (dict): Configuration containing aspectRatio, imageSize, useGrounding.
        reference_images (list): List of base64 data URIs.
        mask_image (str): Base64 data URI of the mask image (white strokes on transparent/black).
    """
    client = get_ai_client()
    
    # Priority: 1. Frontend config, 2. .env file, 3. Default safe model
    env_model_id = os.environ.get('IMAGE_MODEL_ID', 'gemini-3-pro-image-preview')
    requested_model_id = config.get('modelId') if config.get('modelId') else env_model_id
    model_id = requested_model_id
    
    # Strict override: Since user's API key lacks 'imagen' billing permissions, 
    # force any lingering 'imagen-3.0' requests (e.g. from cached nodes) to use gemini-3-pro
    if 'imagen-3.0' in model_id:
        model_id = 'gemini-3-pro-image-preview'

    # Guardrail: force image-capable model for image generation paths.
    # Some legacy workflow nodes may still store text-only model IDs (e.g. gemini-1.5-pro).
    lower_model = (model_id or '').lower()
    if ('image' not in lower_model) and ('imagen' not in lower_model):
        print(f"Non-image model requested for image generation ({model_id}). Falling back to gemini-3-pro-image-preview.")
        model_id = 'gemini-3-pro-image-preview'
    
    reference_images = reference_images or []
    
    # Check if grounding is requested
    tools = []
    if config.get('useGrounding'):
        tools.append(types.Tool(google_search=types.GoogleSearch()))

    # Construct parts
    parts = []
    
    # 1. Add reference images
    for img_str in reference_images:
        processed_bytes, processed_mime = process_reference_image(img_str)
        if processed_bytes:
            parts.append(types.Part.from_bytes(data=processed_bytes, mime_type=processed_mime))

    # 2. Add Mask Image if present
    if mask_image:
        processed_mask_bytes, processed_mask_mime = process_reference_image(mask_image)
        if processed_mask_bytes:
            parts.append(types.Part.from_bytes(data=processed_mask_bytes, mime_type=processed_mask_mime))
            print("Mask image appended to parts.")
    
    # 3. Add text prompt
    # Append instructions for handling mask if present
    final_prompt = prompt
    if mask_image:
        # Stronger instruction for Inpainting / Mask adherence
        final_prompt = (
            f"[INPAINTING TASK]\n"
            f"User Prompt: {prompt}\n"
            f"STRICT INSTRUCTION: A mask image has been provided (Red = Edit, Transparent = Keep). "
            f"You MUST ONLY change the content within the masked semi-transparent red area based on the User Prompt. "
            f"The rest of the image (transparent areas in the mask) MUST remain pixel-perfect identical to the original reference image. "
            f"Do not alter the background, face, or any unmasked details. "
            f"Seamlessly blend the new content into the masked region."
        )

    # Midjourney-style prefix can push some models to answer with text plans.
    if isinstance(final_prompt, str) and final_prompt.strip().lower().startswith('/imagine prompt:'):
        final_prompt = final_prompt.strip()[len('/imagine prompt:'):].strip()

    print(f"Generating with prompt: {final_prompt}")
    print(f"Number of reference images: {len(reference_images)}")
    
    # Append aspect ratio and resolution
    suffixes = []
    if config.get('aspectRatio'):
            suffixes.append(f"--aspect {config.get('aspectRatio')}")
    
    resolution = config.get('resolution')
    if resolution == '2K':
        suffixes.append("2k resolution, high quality")
    elif resolution == '4K':
        suffixes.append("4k resolution, ultra high definition, extremely detailed")
    
    if suffixes:
        final_prompt = f"{final_prompt} {', '.join(suffixes)}"

    def call_image_model(active_model_id, prompt_text):
        call_parts = list(parts)
        call_parts.append(types.Part.from_text(text=prompt_text))
        response = client.models.generate_content(
            model=active_model_id,
            contents=[types.Content(parts=call_parts)],
            config=types.GenerateContentConfig(
                tools=tools if tools else None,
            )
        )

        text_parts = []
        if response.candidates:
            for candidate in response.candidates:
                if not candidate.content or not candidate.content.parts:
                    continue
                for part in candidate.content.parts:
                    if getattr(part, 'inline_data', None):
                        mime_type = part.inline_data.mime_type
                        data = part.inline_data.data
                        b64_data = base64.b64encode(data).decode('utf-8')
                        return f"data:{mime_type};base64,{b64_data}", text_parts
                    if hasattr(part, 'text') and part.text:
                        text_parts.append(part.text.strip())
        return None, text_parts

    # Execute generation with retries/fallbacks for text-only responses.
    try:
        strict_suffix = "\n\n[OUTPUT FORMAT]\nGenerate an image only. Do not return explanatory text."
        fallback_model = os.environ.get('IMAGE_FALLBACK_MODEL', 'gemini-2.5-flash-image-preview')
        model_candidates = [model_id]
        if fallback_model and fallback_model not in model_candidates:
            model_candidates.append(fallback_model)
        if 'gemini-3-pro-image-preview' not in model_candidates:
            model_candidates.append('gemini-3-pro-image-preview')

        last_text_parts = []
        for candidate_model in model_candidates:
            image_uri, text_parts = call_image_model(candidate_model, final_prompt)
            if image_uri:
                return image_uri
            last_text_parts = text_parts or last_text_parts

            # Retry once with a strict image-only instruction if text-only answer came back.
            if text_parts:
                image_uri, text_parts_retry = call_image_model(candidate_model, f"{final_prompt}{strict_suffix}")
                if image_uri:
                    return image_uri
                if text_parts_retry:
                    last_text_parts = text_parts_retry

        if last_text_parts:
            sample = last_text_parts[0][:180]
            raise ValueError(
                f"Model returned text-only response (requested: {requested_model_id}, used: {model_candidates[-1]}). "
                f"Sample: {sample}"
            )
        raise ValueError(
            f"No image found in response (requested: {requested_model_id}, tried: {', '.join(model_candidates)})."
        )

    except errors.ServerError as e:
        print(f"GOOGLE API SERVER ERROR: {e}")
        if e.code == 503 or 'overloaded' in str(e).lower():
            raise ValueError("Google AI Server is currently busy (Overloaded). Please try again in about 1 minute.")
        if e.code == 500:
            raise ValueError("Google AI Server Internal Error. This might be due to complex prompt or large reference images.")
        raise e
    except Exception as api_error:
        print(f"GOOGLE API CALL FAILED: {api_error}")
        raise api_error




def generate_midjourney_prompt(data):
    """
    Generates a high-quality Midjourney prompt using Gemini 1.5 Flash.
    Incorporates both user text parameters and reference images.
    """
    client = get_ai_client()
    
    parts = []
    
    # 1. Attach Reference Images if any
    reference_images = data.get('referenceImages', [])
    for img_str in reference_images:
        processed_bytes, processed_mime = process_reference_image(img_str)
        if processed_bytes:
            parts.append(types.Part.from_bytes(data=processed_bytes, mime_type=processed_mime))
            
    # 2. Extract Text Inputs
    subject = data.get('subject', '')
    presets = ", ".join(data.get('presets', []))
    config = data.get('config', {})
    media_type = data.get('media_type', 'image')
    
    resolution = config.get('resolution', '')
    ar = config.get('aspectRatio', '')
    
    # 3. Construct the prompt instructions
    if media_type == 'video':
        system_instruction = """
        You are an expert AI Video Prompt Engineer (e.g., for Runway Gen-3, Sora, or Luma).
        Convert user inputs and reference images into a high-end, cinematic video generation prompt.
        
        Structure:
        [Camera Movement] + [Subject & Action] + [Environment & Lighting] + [Cinematic Look & Film Stock]
        
        Rules:
        1. Translate everything to English, producing a single dense paragraph.
        2. Do NOT use conversational text or markdown. Output raw text ONLY.
        3. Emphasize motion, cinematic camera angles, and dynamic lighting.
        4. Deeply analyze provided reference images. Incorporate key visual elements into the description.
        5. Ensure the 'User Concept' takes priority for the narrative/subject, while blending in 'Presets' seamlessly.
        """
    else:
        system_instruction = """
        You are an expert Midjourney Portrait Prompt Engineer.
        Convert user inputs and reference images into a high-end, photorealistic Midjourney prompt.
        
        Structure:
        /imagine prompt: [Subject & Physical Traits] + [Pose & Action] + [Clothing & Style] + [Environment & Setting] + [Lighting & Atmosphere] + [Camera Angle & Quality]
        
        Rules:
        1. Translate everything to English, producing a single dense paragraph of descriptive keywords separated by commas.
        2. Do NOT use conversational text or markdown. Output raw text ONLY, starting with "/imagine prompt: "
        3. Do NOT include any --v parameter.
        4. Do NOT include --ar parameter; it will be appended automatically.
        5. Deeply analyze provided reference images. Incorporate key visual elements into the description.
        6. Ensure the 'User Concept' takes priority for the narrative/subject, while blending in 'Presets' seamlessly.
        """

    user_message = f"""
    User Concept: {subject if subject else 'Synthesize a creative scene based on the attached images.'}
    Presets (Styles/Keywords): {presets}
    Target Resolution: {resolution}
    """
    
    # Text part must be appended as well
    parts.append(types.Part.from_text(text=user_message))
    
    try:
        # Prompt model fallback chain:
        # 1) Frontend-selected modelId, 2) env defaults, 3) safe backups.
        default_prompt_model = "gemini-2.5-flash" if media_type == 'video' else "gemini-2.0-flash"
        preferred_model = config.get('modelId') or os.environ.get("PROMPT_MODEL_ID", default_prompt_model)
        candidate_models = []
        for m in [preferred_model, os.environ.get("PROMPT_MODEL_ID"), "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]:
            if m and m not in candidate_models:
                candidate_models.append(m)

        response = None
        last_error = None
        for model_id in candidate_models:
            try:
                response = client.models.generate_content(
                    model=model_id,
                    contents=[types.Content(parts=parts)],
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=0.7
                    )
                )
                if response and getattr(response, "text", None):
                    break
            except Exception as e:
                last_error = e
                print(f"Prompt model failed ({model_id}): {e}")
                continue

        if not response or not getattr(response, "text", None):
            if last_error:
                raise last_error
            raise ValueError("Prompt generation failed: no response text from candidate models.")

        generated_text = response.text.replace('\n', ' ').strip()
        
        if media_type == 'image':
            # Post-Processing: Append AR from config only for image mode
            if ar and "--ar" not in generated_text:
                generated_text += f" --ar {ar}"
            
            # Remove --v if AI hallucinates it
            import re
            generated_text = re.sub(r'--v\s+[0-9.]+', '', generated_text).strip()

        return generated_text

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Gemini Prompt Gen Error: {e}")
        return f"Error generating prompt: {str(e)}"
