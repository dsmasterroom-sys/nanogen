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
    
    # Strip Workflow Studio UI prefixes to prevent confusing the image model
    raw = re.sub(r'\[AGENT INSTRUCTION\][\r\n]*', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'\[NODE PROMPT\][\r\n]*', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'\[UPSTREAM TEXT INPUTS\][\r\n]*', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'\[EXECUTION PROMPT\][\r\n]*', '', raw, flags=re.IGNORECASE)
    raw = raw.strip()

    if not raw:
        return ""

    # If prompt contains multiple scenario blocks like:
    # Style: ... Scene: ... Cinematography: ... Actions: ...
    # keep only the first scenario for single-image generation,
    # UNLESS the user explicitly wants a multi-shot grid.
    is_multi_shot_grid = bool(re.search(r'multi[-_ ]?shot|contact sheet|split image|\d+\s*분할', raw, flags=re.IGNORECASE))
    
    if not is_multi_shot_grid:
        style_hits = [m.start() for m in re.finditer(r'\bstyle\s*:', raw, flags=re.IGNORECASE)]
        if len(style_hits) > 1:
            raw = raw[style_hits[0]:style_hits[1]].strip()

    section_pattern = re.compile(
        r'(?:\[|\b)(Style|Scene|Cinematography|Actions|Dialogue|Background sound)(?:\]|&.*\]|\s*:\s*)',
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
    
    if is_multi_shot_grid:
        grid_format = "multi-shot grid or contact sheet"
        count_examples = len(re.findall(r'Example\s*\d+|Shot\s*\d+|Scene\s*\d+', raw, re.IGNORECASE))
        if count_examples == 4 or "4분할" in raw or "2x2" in raw.lower() or "4 split" in raw.lower():
            grid_format = "2x2 split grid (exactly 4 panels)"
            
        focused = (
            f"Generate a {grid_format} image containing all the requested scenes. "
            "CRITICAL: Do not include any text, subtitles, watermarks, or dialogue in the image to prevent corrupted characters. "
            f"{focused}"
        )
    else:
        focused = (
            "Generate a single still image. Ignore dialogue, audio cues, timing markers, and multi-shot transitions. "
            "CRITICAL: Do not include any text, subtitles, watermarks, or dialogue in the image to prevent corrupted characters. "
            f"{focused}"
        )
    return focused[:1800]

def extract_video_focused_prompt(prompt, duration_seconds=8):
    """
    Parses a prompt structure containing UI tags and scene markers.
    Builds a unified timecoded sequence instruction for Veo to ensure scene distribution.
    Also extracts upstream characters/objects to set consistent context.
    """
    if not isinstance(prompt, str):
        return ""

    raw = prompt.strip()
    
    # 1) Extract upstream context (often containing character/object definitions)
    upstream_context = ""
    upstream_match = re.search(r'\[UPSTREAM TEXT INPUTS\](.*?)(\[NODE PROMPT\]|\[EXECUTION PROMPT\]|$)', raw, flags=re.IGNORECASE | re.DOTALL)
    if upstream_match:
        upstream_context = upstream_match.group(1).strip()
    
    node_context = ""
    node_match = re.search(r'\[NODE PROMPT\](.*?)(\[EXECUTION PROMPT\]|\[UPSTREAM TEXT INPUTS\]|$)', raw, flags=re.IGNORECASE | re.DOTALL)
    if node_match:
        node_context = node_match.group(1).strip()
        
    execution_context = raw
    execution_match = re.search(r'\[EXECUTION PROMPT\](.*?)(\[NODE PROMPT\]|\[UPSTREAM TEXT INPUTS\]|$)', raw, flags=re.IGNORECASE | re.DOTALL)
    if execution_match:
        execution_context = execution_match.group(1).strip()

    # Combine context
    global_context = []
    if upstream_context:
        global_context.append(f"Main Subjects / Environment: {upstream_context}")
    if node_context:
        global_context.append(f"Base Tone / Subject: {node_context}")

    # Combined execution clean
    clean_exec = execution_context
    clean_exec = re.sub(r'\[AGENT INSTRUCTION\][\r\n]*', '', clean_exec, flags=re.IGNORECASE)
    clean_exec = re.sub(r'\[NODE PROMPT\][\r\n]*', '', clean_exec, flags=re.IGNORECASE)
    clean_exec = re.sub(r'\[UPSTREAM TEXT INPUTS\][\r\n]*', '', clean_exec, flags=re.IGNORECASE)
    clean_exec = re.sub(r'\[EXECUTION PROMPT\][\r\n]*', '', clean_exec, flags=re.IGNORECASE).strip()

    # 2) Identify Scenes
    lines = clean_exec.split('\n')
    scenes = []
    current_scene = []
    
    for line in lines:
        line_clean = line.strip()
        if not line_clean:
            continue
            
        scene_match = re.match(r'^(example\s*\d+|단락\s*\d+|상황\s*\d+|shot\s*\d+|scene\s*\d+|\d+\.|-|\*)([:.\s]+|$)(.*)', line_clean, re.IGNORECASE)
        if scene_match:
            if current_scene:
                scenes.append(" ".join(current_scene).strip())
            
            content = scene_match.group(3).strip()
            if content:
                current_scene = [content]
            else:
                current_scene = []
        else:
            current_scene.append(line_clean)
                
    if current_scene:
        scenes.append(" ".join(current_scene).strip())

    # Fallback to Style blocks if no shot markers found
    if len(scenes) < 2:
        starts = [m.start() for m in re.finditer(r'\bstyle\s*:', clean_exec, flags=re.IGNORECASE)]
        if len(starts) >= 2:
            scenes = []
            for i in range(len(starts)):
                s = starts[i]
                e = starts[i + 1] if i + 1 < len(starts) else len(clean_exec)
                chunk = clean_exec[s:e].strip()
                if chunk:
                    scenes.append(chunk)

    # Clean non-visual cues from scenes (similar to image focused)
    cleaned_scenes = []
    for s in scenes:
        filtered = []
        for l in re.split(r'[\n\r]+', s):
            lower = l.lower()
            if any(k in lower for k in [
                'dialogue', 'background sound', 'voice over', 'voiceover',
                'sound:', '[00:', '나레이션'
            ]):
                continue
            if l.strip():
                filtered.append(l.strip())
        cleaned_scenes.append(" ".join(filtered))

    if not cleaned_scenes:
        cleaned_scenes = [clean_exec[:1800]]

    # 3) Build Final Prompt
    final_prompt_parts = []
    
    if global_context:
        final_prompt_parts.append("\n".join(global_context))
        final_prompt_parts.append("Must use the subjects above for the entirety of the video sequence.")

    # Apply Timeline
    num_scenes = len(cleaned_scenes)
    if num_scenes > 1:
        time_per_scene = max(1.0, duration_seconds / num_scenes)
        final_prompt_parts.append("This is a continuous dynamic video. Generate events along this timeline:")
        for i, scene_desc in enumerate(cleaned_scenes[:6]): # Cap at 6 scenes to avoid prompt overload
            start_ts = int(i * time_per_scene)
            end_ts = int((i + 1) * time_per_scene) if i < num_scenes - 1 else duration_seconds
            final_prompt_parts.append(f"- {start_ts}s to {end_ts}s: {scene_desc}")
    else:
        final_prompt_parts.append("Video Description:")
        final_prompt_parts.append(cleaned_scenes[0])
        
    return "\n\n".join(final_prompt_parts)[:2500]

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
        fallback_model = os.environ.get('IMAGE_FALLBACK_MODEL', 'gemini-3-pro-image-preview')
        model_candidates = [model_id]
        if fallback_model and fallback_model not in model_candidates:
            model_candidates.append(fallback_model)
        if 'gemini-3-pro-image-preview' not in model_candidates:
            model_candidates.append('gemini-3-pro-image-preview')

        last_text_parts = []
        last_diagnostics = None
        errors_list = []
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
                errors_list.append(f"{candidate_model}: {candidate_err}")
                continue

        if last_text_parts:
            sample = last_text_parts[0][:500]
            print(f">>> Gemini image model returned text: {last_text_parts}")
            print(f">>> Diagnostics: {last_diagnostics}")
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
                
        error_reason = f"No image found in response (requested: {requested_model_id}, tried: {', '.join(model_candidates)})."
        if errors_list:
            error_details = " | ".join(errors_list)
            error_reason += f" API Errors: [{error_details}]"
            
        raise ValueError(error_reason + diag_msg)

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
        'sora',
        'kling-ai',
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

    primary_prompt = extract_video_focused_prompt(prompt, duration_seconds=duration_seconds).strip()
    fallback_prompt = _compress_prompt(primary_prompt)
    if not fallback_prompt:
        fallback_prompt = primary_prompt[:1800]

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




def get_kling_jwt_token():
    import jwt
    import time
    
    ak = os.environ.get('KLING_ACCESS_KEY')
    sk = os.environ.get('KLING_SECRET_KEY')
    
    if not ak or not sk:
        raise ValueError("Missing KLING_ACCESS_KEY or KLING_SECRET_KEY in environment.")
        
    headers = {
        "alg": "HS256",
        "typ": "JWT"
    }
    payload = {
        "iss": ak,
        "exp": int(time.time()) + 1800, # valid for 30 minutes
        "nbf": int(time.time()) - 5
    }
    
    token = jwt.encode(payload, sk, headers=headers)
    return token


def generate_video_with_kling(prompt, config, reference_images=None):
    import json
    import time
    import urllib.request
    import urllib.error
    import requests # Required for easier multi-part and JSON operations

    reference_images = reference_images or []

    if not prompt or not isinstance(prompt, str):
        raise ValueError("Prompt is required for video generation.")

    duration_seconds = 5
    if isinstance(config, dict):
        d = int(config.get('durationSeconds', 5))
        duration_seconds = 10 if d > 5 else 5

    # 1. Process prompt
    primary_prompt = extract_video_focused_prompt(prompt, duration_seconds=duration_seconds).strip()

    # 2. Get Token
    token = get_kling_jwt_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # 3. Check for I2V vs T2V
    base_endpoint = "text2video"
    api_url = f"https://api.klingai.com/v1/videos/{base_endpoint}"
    
    model_id = config.get('modelId', 'kling-v2-6') if isinstance(config, dict) else 'kling-v2-6'
    # Fallback if old 'kling-ai' string somehow comes through
    if model_id == 'kling-ai':
        model_id = 'kling-v2-6'

    kling_mode = config.get('klingMode', 'std') if isinstance(config, dict) else 'std'
        
    payload = {
        "model_name": model_id,
        "prompt": primary_prompt,
        "duration": "10" if duration_seconds == 10 else "5",
        "mode": kling_mode
    }

    camera_movement = config.get('cameraMovement', '') if isinstance(config, dict) else ''
    if camera_movement:
        camera_map = {
            'pan_left': 'left',
            'pan_right': 'right',
            'tilt_up': 'up',
            'tilt_down': 'down',
            'zoom_in': 'zoom_in',
            'zoom_out': 'zoom_out'
        }
        kling_cam_type = camera_map.get(camera_movement)
        if kling_cam_type:
            payload["camera_control"] = {
                "type": kling_cam_type,
                "value": 5
            }
    
    if reference_images:
        img_bytes, img_mime = process_reference_image(reference_images[0])
        if img_bytes:
            import base64
            # Kling API expects raw base64 string, NOT a data URI with mime type.
            b64_data = base64.b64encode(img_bytes).decode('utf-8')
            
            base_endpoint = "image2video"
            api_url = f"https://api.klingai.com/v1/videos/{base_endpoint}"
            payload["image"] = b64_data

    # 4. Submit Task
    response = requests.post(api_url, headers=headers, json=payload)
    if response.status_code != 200:
        raise ValueError(f"Kling AI Task Submit Failed ({response.status_code}): {response.text}")
    
    resp_data = response.json()
    if resp_data.get('code') != 0:
        raise ValueError(f"Kling AI API Error: {resp_data.get('message')}")
        
    task_id = resp_data.get('data', {}).get('task_id')
    if not task_id:
        raise ValueError("Kling AI did not return a task_id.")

    # 5. Poll Task Status
    poll_url = f"https://api.klingai.com/v1/videos/{base_endpoint}/tasks/{task_id}"
    timeout_sec = 1200 # 20 minutes max
    poll_interval_sec = 10
    started_at = time.time()

    video_url = None
    while time.time() - started_at < timeout_sec:
        # Re-generate token to ensure it doesn't expire during long polling
        poll_headers = {
            "Authorization": f"Bearer {get_kling_jwt_token()}"
        }
        poll_resp = requests.get(poll_url, headers=poll_headers)
        if poll_resp.status_code == 200:
            p_data = poll_resp.json()
            if p_data.get('code') == 0:
                status = p_data.get('data', {}).get('task_status')
                if status == 'succeed':
                    video_results = p_data.get('data', {}).get('task_result', {}).get('videos', [])
                    if video_results:
                        video_url = video_results[0].get('url')
                    break
                elif status == 'failed':
                    err_msg = p_data.get('data', {}).get('task_status_msg', 'Unknown Error')
                    raise ValueError(f"Kling AI Video Generation Failed: {err_msg}")
        
        time.sleep(poll_interval_sec)

    if not video_url:
        raise ValueError("Kling AI Video generation timed out or returned no URL.")

    # 6. Download Video
    vid_resp = requests.get(video_url)
    if vid_resp.status_code != 200:
        raise ValueError("Failed to download generated video from Kling AI.")

    video_bytes = vid_resp.content
    mime_type = "video/mp4"

    return video_bytes, mime_type, "kling-ai"

def generate_midjourney_prompt(data):
    """
    Executes a custom prompt generation task based on user-provided instructions (Execution Prompt)
    and reference data (Knowledge & Brief).
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
    execution_prompt = (data.get('executionPrompt') or '').strip()
    knowledge_and_brief = (data.get('knowledgeAndBrief') or '').strip()
    config = data.get('config', {})
    
    resolution = config.get('resolution', '')
    outputs_match = re.search(r'(\d+)\s*outputs?\b', execution_prompt + ' ' + knowledge_and_brief, flags=re.IGNORECASE)
    requested_output_count = int(outputs_match.group(1)) if outputs_match else 1
    requested_output_count = max(1, min(6, requested_output_count))
    
    # 3. Construct synthesis instructions
    system_instruction = """
    You are an expert AI Prompt Agent.
    Your objective is to strictly execute the instructions provided in the EXECUTION PROMPT.
    Use the PROVIDED KNOWLEDGE & BRIEF as your primary data and context to fulfill the instructions.
    
    Hard Requirements:
    1. Output MUST be in the requested language (default to English if unspecified).
    2. Do NOT output conversational filler like "Here is the prompt:" or "Understood.".
    3. Output ONLY the final requested result based on the execution prompt.
    4. If the execution prompt asks for a specific format (e.g., structured sections, lists, etc), follow it exactly.
    """

    user_message = f"""
    EXECUTION PROMPT:
    {execution_prompt if execution_prompt else 'Enhance the provided knowledge and brief into a production-ready prompt.'}

    PROVIDED KNOWLEDGE & BRIEF:
    {knowledge_and_brief if knowledge_and_brief else '(none)'}
    
    TARGET RESOLUTION:
    {resolution if resolution else '(none)'}
    
    REQUESTED OUTPUT COUNT:
    {requested_output_count}
    """
    
    # Text part must be appended as well
    parts.append(types.Part.from_text(text=user_message))
    
    try:
        # Prompt model fallback chain. Prefer gemini-2.5-flash for prompts.
        default_prompt_model = "gemini-2.5-flash"
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

        generated_text = response.text.strip()
        
        return generated_text

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Gemini Prompt Gen Error: {e}")
        return f"Error generating prompt: {str(e)}"
