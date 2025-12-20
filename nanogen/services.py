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
    model_id = 'gemini-3-pro-image-preview' # Nanobanana 3 Pro (Imagen 3)
    
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

    parts.append(types.Part.from_text(text=final_prompt))
             
    # Execute generation
    try:
        response = client.models.generate_content(
            model=model_id,
            contents=[types.Content(parts=parts)],
            config=types.GenerateContentConfig(
                tools=tools if tools else None,
            )
        )

    except errors.ServerError as e:
        print(f"GOOGLE API SERVER ERROR: {e}")
        # Handle 503 and 500 specifically
        if e.code == 503 or 'overloaded' in str(e).lower():
            raise ValueError("Google AI Server is currently busy (Overloaded). Please try again in about 1 minute.")
        if e.code == 500:
            raise ValueError("Google AI Server Internal Error. This might be due to complex prompt or large reference images. Try reducing the number of reference images or simplifying the prompt.")
        raise e
    except Exception as api_error:
        print(f"GOOGLE API CALL FAILED: {api_error}")
        # Raise specifics if possible
        raise api_error
    
    # Parse response
    if response.candidates:
        for candidate in response.candidates:
            for part in candidate.content.parts:
                if part.inline_data:
                    mime_type = part.inline_data.mime_type
                    data = part.inline_data.data
                    # data is bytes in Python SDK usually? Or base64 string?
                    # In new SDK, inline_data.data is usually bytes.
                    b64_data = base64.b64encode(data).decode('utf-8')
                    return f"data:{mime_type};base64,{b64_data}"
    
    print("Response received but no candidates/images found.")
    print(response)
    raise ValueError("No image found in response.")




def generate_midjourney_prompt(data):
    """
    Generates a Midjourney prompt based on 5-step expert structure.
    """
    subject = data.get('subject', '')
    config = data.get('config', {})  # Extract config
    
    # Step 0: Basic Info
    species = data.get('species', 'Human')
    animal_type = data.get('animalType', '')
    gender = data.get('gender', 'Female')
    
    # Construct base subject description
    base_subject_desc = ""
    if species == 'Animal':
        base_subject_desc = f"{animal_type}" if animal_type else "Animal"
    else:
        # For Human, use Gender
        base_subject_desc = f"{gender}"

    # Step 1: Style & Details
    styles = ", ".join(data.get('styles', []))
    global_details = ", ".join(data.get('global_details', []))
    
    # Step 2: Characteristics, Expression, Angle
    characteristics = ", ".join(data.get('characteristics', []))
    expression = data.get('expression', '')
    camera_angle = data.get('camera_angle', '')
    
    # Step 3: Pose & Action
    pose = data.get('pose', '')
    action = data.get('action', '')
    
    # Step 4: Lighting & Atmosphere
    lighting = data.get('lighting', '')
    atmosphere = ", ".join(data.get('atmosphere', []))
    
    # Step 5: Character & Env Details
    character_details = ", ".join(data.get('character_details', []))
    env_details = ", ".join(data.get('env_details', []))

    # Append Resolution to global details for valid prompt inclusion
    resolution = config.get('resolution', '')
    if resolution == '2K':
        global_details += ", 2k resolution, high quality"
    elif resolution == '4K':
        global_details += ", 4k resolution, ultra high definition, extremely detailed, 8k"

    # Construct System Instruction
    system_instruction = """
    You are an expert Midjourney Portrait Prompt Engineer.
    Convert user inputs into a high-end, photorealistic prompt.
    
    Structure:
    /imagine prompt: [Subject + Characteristics + Expression] + [Action/Pose] + [Clothing/Decor] + [Environment] + [Lighting & Atmosphere] + [Camera/Angle] + [Style/Quality]

    Rules:
    1. Translate Korean to English.
    2. Write a natural, partially descriptive paragraph.
    3. Ensure technical keywords (camera, lighting) are placed effectively.
    4. Do NOT include any --v parameter (e.g. --v 6.0, --v 6.1) unless the user explicitly asked for it in the context.
    5. Do NOT include --ar parameter in the generated text; the system will append it.
    6. Prioritize "Photorealism" and "Skin Texture" details if style implies it.
    """

    user_message = f"""
    Subject Type: {base_subject_desc}
    Additional Context: {subject}
    
    1. Look/Style: {styles}
    1. Global Details: {global_details}
    
    2. Characteristics: {characteristics}
    2. Expression: {expression}
    2. Camera Angle: {camera_angle}
    
    3. Pose: {pose}
    3. Action: {action}
    
    4. Lighting: {lighting}
    4. Atmosphere: {atmosphere}
    
    5. Character Details: {character_details}
    5. Env/Clothing Details: {env_details}
    """

    try:
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key:
             raise ValueError("API Key not found in .env")

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-1.5-flash", # Revert to 1.5-flash for stability/quota
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction
            )
        )
        
        generated_text = response.text.strip()
        
        # Post-Processing: Append AR from config
        ar = config.get('aspectRatio', '')
        if ar:
            # Ensure no duplicate --ar
            if "--ar" not in generated_text:
                generated_text += f" --ar {ar}"
        
        # Double check to remove --v if AI hallucinates it
        import re
        generated_text = re.sub(r'--v\s+[0-9.]+', '', generated_text).strip()

        return generated_text

    except Exception as e:
        print(f"Gemini Prompt Gen Error: {e}")
        return f"Error generating prompt: {str(e)}"
