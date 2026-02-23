import os
import io
import base64
import time
import tempfile
import re
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


def extract_image_focused_prompt(prompt):
    """
    Convert mixed video/image script text into an image-focused prompt.
    Non-image instructions (dialogue, audio, timeline, multi-shot sequencing)
    are removed or ignored.
    """
    if not isinstance(prompt, str):
        return ""

    raw = prompt.strip()
    if not raw:
        return ""

    # If prompt contains multiple scenario blocks like:
    # Style: ... Scene: ... Cinematography: ... Actions: ...
    # keep only the first scenario for single-image generation.
    style_hits = [m.start() for m in re.finditer(r'\bstyle\s*:', raw, flags=re.IGNORECASE)]
    if len(style_hits) > 1:
        raw = raw[style_hits[0]:style_hits[1]].strip()

    section_pattern = re.compile(
        r'\b(Style|Scene|Cinematography|Actions|Dialogue|Background sound)\s*:\s*',
        flags=re.IGNORECASE
    )
    matches = list(section_pattern.finditer(raw))
    kept_chunks = []

    if matches:
        allowed_sections = {'style', 'scene', 'cinematography', 'actions'}
        for idx, m in enumerate(matches):
            name = (m.group(1) or '').strip().lower()
            start = m.end()
            end = matches[idx + 1].start() if idx + 1 < len(matches) else len(raw)
            value = raw[start:end].strip()
            if not value or name not in allowed_sections:
                continue
            kept_chunks.append(value)
    else:
        # Generic text fallback: drop lines/sentences that are clearly non-image.
        filtered_lines = []
        for line in re.split(r'[\n\r]+', raw):
            lower = line.lower()
            if any(k in lower for k in [
                'dialogue', 'background sound', 'voice over', 'voiceover',
                'shot 1', 'shot 2', 'shot 3', '[00:', 'camera movement', 'sound:'
            ]):
                continue
            if line.strip():
                filtered_lines.append(line.strip())
        kept_chunks = filtered_lines

    if not kept_chunks:
        return raw[:1800]

    focused = ", ".join(kept_chunks)
    focused = re.sub(r'\s+', ' ', focused).strip(' ,')
    focused = (
        "Generate a single still image. Ignore dialogue, audio cues, timing markers, and multi-shot transitions. "
        f"{focused}"
    )
    return focused[:1800]

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

    # Normalize deprecated/invalid image model IDs from older saved workflows.
    deprecated_model_aliases = {
        'gemini-2.5-flash-image-preview': 'gemini-2.0-flash-preview-image-generation',
    }
    model_id = deprecated_model_aliases.get(model_id, model_id)
    
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
    final_prompt = extract_image_focused_prompt(prompt)
    if not final_prompt:
        final_prompt = prompt
    if mask_image:
        # Stronger instruction for Inpainting / Mask adherence
        final_prompt = (
            f"[INPAINTING TASK]\n"
            f"User Prompt: {final_prompt}\n"
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
        diagnostics = {
            'finish_reasons': [],
            'prompt_feedback': '',
            'safety': []
        }
        try:
            pf = getattr(response, 'prompt_feedback', None)
            if pf:
                diagnostics['prompt_feedback'] = str(pf)
        except Exception:
            pass
        if response.candidates:
            for candidate in response.candidates:
                try:
                    fr = getattr(candidate, 'finish_reason', None)
                    if fr is not None:
                        diagnostics['finish_reasons'].append(str(fr))
                except Exception:
                    pass
                try:
                    sr_list = getattr(candidate, 'safety_ratings', None) or []
                    for sr in sr_list:
                        diagnostics['safety'].append(str(sr))
                except Exception:
                    pass
                if not candidate.content or not candidate.content.parts:
                    continue
                for part in candidate.content.parts:
                    if getattr(part, 'inline_data', None):
                        mime_type = part.inline_data.mime_type
                        data = part.inline_data.data
                        b64_data = base64.b64encode(data).decode('utf-8')
                        return f"data:{mime_type};base64,{b64_data}", text_parts, diagnostics
                    if hasattr(part, 'text') and part.text:
                        text_parts.append(part.text.strip())
        return None, text_parts, diagnostics

    # Execute generation with retries/fallbacks for text-only responses.
    try:
        strict_suffix = "\n\n[OUTPUT FORMAT]\nGenerate an image only. Do not return explanatory text."
        fallback_model = os.environ.get('IMAGE_FALLBACK_MODEL', 'gemini-2.0-flash-preview-image-generation')
        model_candidates = [model_id]
        if fallback_model and fallback_model not in model_candidates:
            model_candidates.append(fallback_model)
        if 'gemini-2.0-flash-preview-image-generation' not in model_candidates:
            model_candidates.append('gemini-2.0-flash-preview-image-generation')
        if 'gemini-3-pro-image-preview' not in model_candidates:
            model_candidates.append('gemini-3-pro-image-preview')

        last_text_parts = []
        last_diagnostics = None
        for candidate_model in model_candidates:
            try:
                image_uri, text_parts, diagnostics = call_image_model(candidate_model, final_prompt)
                if image_uri:
                    return image_uri
                last_text_parts = text_parts or last_text_parts
                last_diagnostics = diagnostics or last_diagnostics

                # Retry once with a strict image-only instruction if text-only answer came back.
                if text_parts:
                    image_uri, text_parts_retry, diagnostics_retry = call_image_model(candidate_model, f"{final_prompt}{strict_suffix}")
                    if image_uri:
                        return image_uri
                    if text_parts_retry:
                        last_text_parts = text_parts_retry
                    last_diagnostics = diagnostics_retry or last_diagnostics
            except Exception as candidate_err:
                # Try next candidate model instead of hard-failing on first 404/unsupported model.
                print(f"Image model failed ({candidate_model}): {candidate_err}")
                continue

        if last_text_parts:
            sample = last_text_parts[0][:180]
            raise ValueError(
                f"Model returned text-only response (requested: {requested_model_id}, used: {model_candidates[-1]}). "
                f"Sample: {sample}"
            )
        diag_msg = ""
        if last_diagnostics:
            finish = ", ".join(last_diagnostics.get('finish_reasons') or [])
            prompt_fb = (last_diagnostics.get('prompt_feedback') or '')[:240]
            safety = ", ".join((last_diagnostics.get('safety') or [])[:3])
            parts_diag = []
            if finish:
                parts_diag.append(f"finish={finish}")
            if prompt_fb:
                parts_diag.append(f"prompt_feedback={prompt_fb}")
            if safety:
                parts_diag.append(f"safety={safety}")
            if parts_diag:
                diag_msg = " Details: " + " | ".join(parts_diag)
        raise ValueError(
            f"No image found in response (requested: {requested_model_id}, tried: {', '.join(model_candidates)}).{diag_msg}"
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


def generate_video_with_veo(prompt, config, reference_images=None):
    """
    Generates a video using Veo models and returns (video_bytes, mime_type, used_model_id).
    """
    client = get_ai_client()
    reference_images = reference_images or []

    requested_model_id = config.get('modelId') if isinstance(config, dict) else None
    env_model_id = os.environ.get('VIDEO_MODEL_ID', 'veo-3.1-generate-preview')
    model_id = requested_model_id or env_model_id

    # Allowlist to avoid accidentally routing video generation to text/prompt models.
    allowed_models = {
        'veo-3.1-generate-preview',
        'veo-3.1-fast-generate-preview',
    }
    if model_id not in allowed_models:
        model_id = 'veo-3.1-fast-generate-preview'

    if not prompt or not isinstance(prompt, str):
        raise ValueError("Prompt is required for video generation.")

    def _compress_prompt(text):
        if not isinstance(text, str):
            return ""
        t = text.strip()
        if not t:
            return ""
        # When prompt-agent output contains multiple scenario blocks,
        # Veo is more reliable with one concise scene direction.
        if "Style:" in t and "Scene:" in t:
            first_block = t.split("\n\n")[0].strip()
            if first_block:
                t = first_block
        return t[:1800]

    primary_prompt = prompt.strip()
    fallback_prompt = _compress_prompt(prompt)
    if not fallback_prompt:
        fallback_prompt = primary_prompt[:1800]

    processed_ref = None
    if reference_images:
        img_bytes, img_mime = process_reference_image(reference_images[0])
        if img_bytes:
            processed_ref = (img_bytes, img_mime or 'image/jpeg')

    aspect_ratio = config.get('aspectRatio') if isinstance(config, dict) else None
    if aspect_ratio not in ('16:9', '9:16', '1:1'):
        aspect_ratio = '16:9'

    duration_seconds = 8
    if isinstance(config, dict):
        try:
            duration_seconds = int(config.get('durationSeconds', 8))
        except Exception:
            duration_seconds = 8
    duration_seconds = max(4, min(8, duration_seconds))

    # Keep config minimal for broad Veo compatibility.
    # Some models reject optional fields like enhancePrompt.
    generate_config = types.GenerateVideosConfig(
        aspectRatio=aspect_ratio,
        durationSeconds=duration_seconds
    )

    def _extract_operation_error(op):
        op_error = getattr(op, 'error', None)
        if op_error:
            return str(op_error)
        response = getattr(op, 'response', None)
        if response is not None:
            blocked = getattr(response, 'rai_media_filtered_count', None)
            if blocked:
                return f"filtered by safety policy (count={blocked})"
        return ""

    def _run_attempt(active_model_id, prompt_text, include_reference):
        source_kwargs = {'prompt': prompt_text}
        if include_reference and processed_ref:
            source_kwargs['image'] = types.Image(imageBytes=processed_ref[0], mimeType=processed_ref[1])
        source = types.GenerateVideosSource(**source_kwargs)
        operation = client.models.generate_videos(
            model=active_model_id,
            source=source,
            config=generate_config
        )
        timeout_sec = int(os.environ.get('VIDEO_GENERATION_TIMEOUT_SEC', '900'))
        poll_interval_sec = int(os.environ.get('VIDEO_GENERATION_POLL_INTERVAL_SEC', '8'))
        started_at = time.time()

        while not operation.done:
            if time.time() - started_at > timeout_sec:
                raise ValueError("Video generation timed out. Please try again.")
            time.sleep(poll_interval_sec)
            operation = client.operations.get(operation)

        op_error = _extract_operation_error(operation)
        if op_error:
            return None, op_error

        response = getattr(operation, 'response', None)
        if not response or not getattr(response, 'generated_videos', None):
            return None, "operation finished but generated_videos was empty"

        generated = response.generated_videos[0]
        video_obj = getattr(generated, 'video', None)
        if not video_obj:
            return None, "generated video object missing"

        try:
            client.files.download(file=video_obj)
        except Exception:
            # Some SDK/runtime combinations still allow .save without explicit download.
            pass

        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as tmp:
            tmp_path = tmp.name

        try:
            video_obj.save(tmp_path)
            with open(tmp_path, 'rb') as f:
                video_bytes = f.read()
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass

        if not video_bytes:
            return None, "generated video bytes are empty"

        mime_type = getattr(video_obj, 'mimeType', None) or getattr(video_obj, 'mime_type', None) or 'video/mp4'
        return (video_bytes, mime_type), ""

    try:
        model_candidates = [model_id]
        for candidate in ['veo-3.1-fast-generate-preview', 'veo-3.1-generate-preview']:
            if candidate not in model_candidates:
                model_candidates.append(candidate)

        attempt_plan = []
        for m in model_candidates:
            attempt_plan.append((m, primary_prompt, True))
            if fallback_prompt != primary_prompt:
                attempt_plan.append((m, fallback_prompt, True))
            attempt_plan.append((m, fallback_prompt, False))

        reasons = []
        for active_model, attempt_prompt, use_ref in attempt_plan:
            try:
                result, reason = _run_attempt(active_model, attempt_prompt, use_ref)
                if result:
                    video_bytes, mime_type = result
                    return video_bytes, mime_type, active_model
                reasons.append(f"{active_model} ref={use_ref}: {reason}")
            except Exception as attempt_error:
                reasons.append(f"{active_model} ref={use_ref}: {attempt_error}")
                continue

        reasons_text = "; ".join(reasons[:4])
        raise ValueError(
            "Video generation finished but no video was returned. "
            f"Tried {len(attempt_plan)} attempts. Details: {reasons_text}"
        )

    except Exception as video_error:
        print(f"VIDEO GENERATION FAILED: {video_error}")
        raise video_error




def generate_midjourney_prompt(data):
    """
    Builds a single, production-ready prompt by fusing:
    - main body text
    - referenced text
    - referenced images

    The output should be a fully integrated final prompt, not a summary or
    a copy-paste of the source text with appended notes.
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
    subject = (data.get('subject') or '').strip()
    presets_raw = data.get('presets', [])
    if not isinstance(presets_raw, list):
        presets_raw = []
    presets_list = [str(v).strip() for v in presets_raw if str(v).strip()]
    presets = ", ".join(presets_list)
    config = data.get('config', {})
    media_type = data.get('media_type', 'image')
    agent_instruction = (data.get('agentInstruction') or data.get('agent_instruction') or '').strip()
    primary_prompt = (data.get('primaryPrompt') or data.get('primary_prompt') or '').strip()
    secondary_text = (data.get('secondaryText') or data.get('secondary_text') or '').strip()
    secondary_lines = [line.strip() for line in secondary_text.splitlines() if line.strip()]
    
    resolution = config.get('resolution', '')
    ar = config.get('aspectRatio', '')
    full_text_context = " ".join([
        primary_prompt or '',
        subject or '',
        secondary_text or '',
        presets or '',
        agent_instruction or ''
    ])
    outputs_match = re.search(r'(\d+)\s*outputs?\b', full_text_context, flags=re.IGNORECASE)
    requested_output_count = int(outputs_match.group(1)) if outputs_match else 1
    requested_output_count = max(1, min(6, requested_output_count))
    
    # 3. Construct synthesis instructions
    if media_type == 'video':
        system_instruction = """
        You are an expert AI Video Prompt Engineer (e.g., for Runway Gen-3, Sora, or Luma).
        Merge all provided inputs (main text, referenced texts, and reference images)
        into production-ready prompt outputs.

        Hard Requirements:
        1. Output must be in English only.
        2. Use this exact section schema per output:
           Style:
           Scene:
           Cinematography:
           Actions:
           Dialogue:
           Background sound:
        3. Do NOT output analysis or markdown fences.
        3. If MAIN BODY TEXT exists, keep it as the backbone and preserve its meaning and structure as much as possible.
        4. Do not aggressively shorten MAIN BODY TEXT; enrich it with missing details from references.
        5. You may rewrite only where needed for fluency/consistency.
        6. Reflect all important details from all inputs unless directly conflicting.
        7. If conflicts exist, resolve them into one coherent direction and keep the result internally consistent.
        8. Emphasize motion, camera language, lighting, texture, and scene continuity.
        """
    else:
        system_instruction = """
        You are an expert Midjourney Portrait Prompt Engineer.
        Merge all provided inputs (main text, referenced texts, and reference images)
        into ONE complete, production-grade Midjourney prompt.

        Hard Requirements:
        1. Output raw text only, starting with "/imagine prompt: ".
        2. Output must be one integrated final prompt, not multiple sections.
        3. Do NOT output labels like "main", "reference", "summary", "notes", or "priority".
        4. If MAIN BODY TEXT exists, keep it as the primary backbone and preserve wording/order as much as possible.
        5. Do not over-compress MAIN BODY TEXT; integrate referenced details into it.
        6. Rewrite only where necessary for coherence and consistency.
        7. Include key details from every input source, resolving conflicts into one consistent art direction.
        8. Do NOT include any --v parameter.
        9. Do NOT include --ar parameter; it will be appended automatically.
        """

    if agent_instruction:
        system_instruction = f"""{system_instruction}

        Additional Creative Direction:
        {agent_instruction}

        Apply this direction while still synthesizing all provided inputs into one final prompt.
        """

    user_message = f"""
    MAIN BODY TEXT:
    {primary_prompt if primary_prompt else '(none)'}

    USER CONCEPT:
    {subject if subject else '(none)'}

    REFERENCED TEXT INPUTS:
    {secondary_text if secondary_text else '(none)'}

    PRESET KEYWORDS:
    {presets if presets else '(none)'}

    TARGET RESOLUTION:
    {resolution if resolution else '(none)'}

    REQUESTED OUTPUT COUNT:
    {requested_output_count}
    """
    if secondary_lines:
        bullet_lines = "\n".join(f"- {line}" for line in secondary_lines)
        user_message += f"""

    REFERENCED TEXT LIST:
    {bullet_lines}
    """
    if presets_list:
        preset_lines = "\n".join(f"- {line}" for line in presets_list)
        user_message += f"""

    PRESET LIST:
    {preset_lines}
    """
    if media_type == 'video':
        user_message += f"""

    OUTPUT FORMAT REQUIREMENT:
    - Generate exactly {requested_output_count} output(s).
    - Separate each output with one blank line.
    - Each output must include all six labeled sections in this order:
      Style, Scene, Cinematography, Actions, Dialogue, Background sound.
    - Keep each output concise but production-ready and internally coherent.
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
                temperature = 0.2
                response = client.models.generate_content(
                    model=model_id,
                    contents=[types.Content(parts=parts)],
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        temperature=temperature
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

        # Safety net: keep user-authored main body when model over-compresses it.
        # Exclude long meta-instruction documents (Situation/Task/Objective/Examples),
        # because forcing them into the final output degrades prompt quality.
        if primary_prompt:
            def _normalize_text(v):
                return re.sub(r'\s+', ' ', (v or '').strip().lower())
            def _looks_like_meta_instruction(v):
                lower = _normalize_text(v)
                meta_markers = ['situation', 'task', 'objective', 'knowledge', 'examples', 'core prompt architecture']
                return sum(1 for m in meta_markers if m in lower) >= 2

            if (not _looks_like_meta_instruction(primary_prompt)) and (_normalize_text(primary_prompt) not in _normalize_text(generated_text)):
                generated_text = f"{primary_prompt.strip()} {generated_text}".strip()

        if media_type == 'image':
            # Post-Processing: Append AR from config only for image mode
            if ar and "--ar" not in generated_text:
                generated_text += f" --ar {ar}"
            
            # Remove --v if AI hallucinates it
            generated_text = re.sub(r'--v\s+[0-9.]+', '', generated_text).strip()

        return generated_text

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Gemini Prompt Gen Error: {e}")
        return f"Error generating prompt: {str(e)}"
