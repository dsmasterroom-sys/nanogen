import json
import base64
import uuid
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.core.files.base import ContentFile
from django.templatetags.static import static
from django.shortcuts import redirect
from django.conf import settings
from .models import GeneratedImage, GeneratedVideo, SourceImage, MidjourneyOption, WorkflowStore


def index(request):
    return render(request, 'nanogen/index.html')

@csrf_exempt
def favicon_view(request):
    try:
        return redirect(static('nanogen/favicon.ico'))
    except:
        return JsonResponse({'status': 'ok'})


def _empty_workflow_store():
    return {'workflows': [], 'activeId': None}


def _normalize_workflow_store(store):
    if not isinstance(store, dict):
        return _empty_workflow_store()
    workflows = store.get('workflows')
    if not isinstance(workflows, list):
        workflows = []
    active_id = store.get('activeId', None)
    normalized = {
        'workflows': workflows,
        'activeId': active_id
    }
    if 'updatedAt' in store:
        normalized['updatedAt'] = store.get('updatedAt')
    return normalized


@csrf_exempt
def workflow_store_view(request):
    if request.method == 'GET':
        try:
            obj = WorkflowStore.objects.filter(key='default').first()
            store = _normalize_workflow_store(obj.data if obj else _empty_workflow_store())
            return JsonResponse({'store': store})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    if request.method == 'POST':
        try:
            body = json.loads(request.body or '{}')
            store = body.get('store')
            if not isinstance(store, dict):
                return JsonResponse({'error': 'Invalid store payload'}, status=400)
            if not isinstance(store.get('workflows'), list):
                return JsonResponse({'error': 'Invalid workflows payload'}, status=400)
            normalized = _normalize_workflow_store(store)
            WorkflowStore.objects.update_or_create(
                key='default',
                defaults={'data': normalized}
            )
            return JsonResponse({'success': True, 'savedWorkflows': len(normalized.get('workflows', []))})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

# --- Midjourney Prompt Gen Data ---

DEFAULT_PRESETS = {
    'styles': [
        {'id': 'photoreal', 'label': 'Photorealistic'},
        {'id': 'cinematic', 'label': 'Cinematic'},
        {'id': 'film_photography', 'label': 'Analog Film (35mm)'},
        {'id': 'fashion', 'label': 'High Fashion'},
        {'id': 'documentary', 'label': 'Documentary'},
        {'id': 'anime', 'label': 'Anime/Manga'},
        {'id': 'cyberpunk', 'label': 'Cyberpunk'},
        {'id': 'oil', 'label': 'Oil Painting'}
    ],
    'global_details': [
        {'id': 'sharp', 'label': 'Sharp Focus'},
        {'id': 'raw', 'label': 'Raw Style'},
        {'id': 'grain', 'label': 'Film Grain'},
        {'id': 'detailed', 'label': 'Hyper-Detailed'},
        {'id': 'minimal', 'label': 'Minimalist'},
        {'id': 'vibrant', 'label': 'Vibrant Colors'},
        {'id': 'muted', 'label': 'Muted Tones'}
    ],
    'expression': ['Neutral', 'Smiling', 'Serious', 'Mysterious', 'Angry', 'Joyful', 'Seductive', 'Gazing at Camera', 'Looking Away'],
    'camera_angle': ['Eye-Level', 'Low Angle (Heroic)', 'High Angle', 'Over-the-Shoulder', 'Close-Up', 'Extreme Close-Up (Macro)', 'Wide Shot', 'Dutch Angle'],
    'characteristics': [
        {'id': 'young', 'label': 'Young'},
        {'id': 'old', 'label': 'Old'},
        {'id': 'beautiful', 'label': 'Beautiful'},
        {'id': 'rugged', 'label': 'Rugged'},
        {'id': 'cute', 'label': 'Cute'}
    ],
    'pose': ['Standing', 'Sitting', 'Walking', 'Running', 'Leaning', 'Dynamic Pose', 'Candid Pose', 'Model Pose'],
    'action': ['', 'Reading', 'Drinking Coffee', 'Holding Flowers', 'Working on Laptop', 'Dancing', 'Fighting'],
    'lighting': ['Natural Light', 'Soft Window Light', 'Golden Hour', 'Studio Lighting', 'Rembrandt Lighting', 'Neon Lights', 'Cinematic Lighting', 'Volumetric Rays'],
    'atmosphere': [
        {'id': 'dreamy', 'label': 'Dreamy'},
        {'id': 'dark', 'label': 'Dark & Moody'},
        {'id': 'romantic', 'label': 'Romantic'},
        {'id': 'futuristic', 'label': 'Futuristic'},
        {'id': 'vintage', 'label': 'Vintage'},
        {'id': 'horror', 'label': 'Eerie/Horror'},
        {'id': 'cozy', 'label': 'Cozy'}
    ],
    'character_details': [
        {'id': 'skin', 'label': 'Detailed Skin Texture'},
        {'id': 'eyes', 'label': 'Sparkling Eyes'},
        {'id': 'hair', 'label': 'Detailed Hair'},
        {'id': 'pores', 'label': 'Visible Pores'},
        {'id': 'freckles', 'label': 'Freckles'},
        {'id': 'makeup', 'label': 'Fashion Makeup'}
    ],
    'env_details': [
        {'id': 'rain', 'label': 'Rainy'},
        {'id': 'fog', 'label': 'Foggy'},
        {'id': 'snow', 'label': 'Snowy'},
        {'id': 'city', 'label': 'City Street'},
        {'id': 'nature', 'label': 'Nature/Forest'},
        {'id': 'indoor', 'label': 'Indoor/Interior'},
        {'id': 'crowd', 'label': 'Crowded'}
    ]
}

@csrf_exempt
def get_midjourney_presets(request):
    try:
        options = MidjourneyOption.objects.all()
        presets = {
            'styles': [], 'global_details': [], 'expression': [], 'camera_angle': [],
            'characteristics': [], 'pose': [], 'action': [], 'lighting': [],
            'atmosphere': [], 'character_details': [], 'env_details': []
        }
        
        # Simple categories expected as list of strings by frontend
        simple_categories = ['expression', 'camera_angle', 'pose', 'action', 'lighting']
        
        for opt in options:
            if opt.category in simple_categories:
                presets[opt.category].append({'id': opt.id, 'value': opt.value, 'label': opt.label}) # Modified to simple string logic handling in frontend or keep object? 
                # Wait, app.js expects strings for simple categories... but we need ID to delete/edit.
                # Recommendation: Return Objects for EVERYTHING. Frontend app.js needs update to handle objects for simple categories too.
                # OR: return a parallel structure.
                # Let's update backend to return objects {alert: breaking change for frontend unless updated}
                # For now let's stick to what app.js expects, BUT wait... how to edit "Happy"? We need its DB ID.
                # So we MUST return objects even for simple categories.
                # Refactoring frontend to handle objects for simple categories is cleaner.
            else:
                presets[opt.category].append({'id': opt.id, 'value': opt.value, 'label': opt.label})

        # Correcting loop above to ALWAYS return objects with ID, Value, Label
        # Frontend MUST be updated to handle this change.
        presets = {k: [] for k in presets.keys()} # Reset
        for opt in options:
            presets[opt.category].append({
                 'db_id': opt.id,
                 'value': opt.value,
                 'label': opt.label
            })
            
        return JsonResponse(presets)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def add_midjourney_option(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            category = data.get('category')
            label = data.get('label')
            
            if not category or not label:
                return JsonResponse({'error': 'Category and Label are required'}, status=400)

            # Generate value key from label if not provided
            value = data.get('value', label.lower().replace(' ', '_'))
            
            option = MidjourneyOption.objects.create(
                category=category,
                label=label,
                value=value,
                order=999 # Append to end
            )
            return JsonResponse({'success': True, 'id': option.id})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

@csrf_exempt
def edit_midjourney_option(request, option_id):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            label = data.get('label')
            
            if not label:
                return JsonResponse({'error': 'Label is required'}, status=400)
                
            option = get_object_or_404(MidjourneyOption, id=option_id)
            option.label = label
            # Optional: update value too? usually value should be stable, but for simple strings maybe.
            # Let's keep value stable to not break generated prompts if they rely on IDs.
            # But wait, Midjourney prompt generator mostly uses the label or value text.
            # For this simple implementation, let's just update label.
            option.save()
            
            return JsonResponse({'success': True})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

@csrf_exempt
def delete_midjourney_option(request, option_id):
    if request.method == 'DELETE':
        try:
            option = get_object_or_404(MidjourneyOption, id=option_id)
            option.delete()
            return JsonResponse({'success': True})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

@csrf_exempt
def reset_midjourney_options(request):
    if request.method == 'POST':
        try:
            # 1. Delete All
            MidjourneyOption.objects.all().delete()
            
            # 2. Repopulate
            count = 0
            for category, items in DEFAULT_PRESETS.items():
                for index, item in enumerate(items):
                    if isinstance(item, str):
                        if not item: continue
                        MidjourneyOption.objects.create(
                            category=category, 
                            label=item, 
                            value=item, 
                            order=index
                        )
                    else:
                        MidjourneyOption.objects.create(
                            category=category, 
                            label=item['label'], 
                            value=item['id'], 
                            order=index
                        )
                    count += 1
            return JsonResponse({'success': True, 'count': count})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

# --- Source Library Views ---

@csrf_exempt
def list_source_images(request):
    try:
        from django.core.paginator import Paginator
        page = request.GET.get('page', 1)
        limit = request.GET.get('limit', 20)
        
        images_query = SourceImage.objects.all().order_by('-created_at')
        paginator = Paginator(images_query, limit)
        images = paginator.get_page(page)
        
        data = []
        for img in images:
            data.append({
                'id': img.id,
                'url': img.image.url,
                'created_at': img.created_at.isoformat()
            })
        return JsonResponse({
            'images': data,
            'page': images.number,
            'num_pages': paginator.num_pages,
            'total': paginator.count
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def upload_source_image(request):
    if request.method == 'POST':
        try:
            # Check if file is in request.FILES
            if 'image' not in request.FILES:
                return JsonResponse({'error': 'No image file provided'}, status=400)
            
            image_file = request.FILES['image']
            source_image = SourceImage.objects.create(image=image_file)
            
            return JsonResponse({
                'success': True,
                'image': {
                    'id': source_image.id,
                    'url': source_image.image.url
                }
            })
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

@csrf_exempt
def delete_source_image(request, image_id):
    if request.method == 'DELETE':
        try:
            image = get_object_or_404(SourceImage, id=image_id)
            image.image.delete()
            image.delete()
            return JsonResponse({'success': True})
        except Exception as e:
             return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

from .services import generate_image_with_gemini, generate_midjourney_prompt, generate_video_with_veo

# ... existing code ...

@csrf_exempt
def generate_midjourney_prompt_view(request):
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            prompt = generate_midjourney_prompt(data)
            return JsonResponse({'prompt': prompt})
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)

# --- Generated Image Views ---

@csrf_exempt
def generate_image_view(request):
    if request.method == 'POST':
        try:
            req_data = json.loads(request.body)
            prompt = req_data.get('prompt')
            config = req_data.get('config', {})
            reference_images = req_data.get('referenceImages', [])
            mask_image = req_data.get('maskImage', None)
            
            if not prompt:
                return JsonResponse({'error': 'Prompt is required'}, status=400)
            
            # Generate image (returns base64 data URI)
            image_b64_uri = generate_image_with_gemini(prompt, config, reference_images, mask_image)
            
            # Save to Database (GeneratedImage only; do not auto-save to Source Library)
            try:
                if 'base64,' in image_b64_uri:
                    format_str, imgstr = image_b64_uri.split(';base64,') 
                    ext = format_str.split('/')[-1]
                    image_bytes = base64.b64decode(imgstr)

                    generated_filename = f"generated_{uuid.uuid4()}.{ext}"

                    generated_image = GeneratedImage.objects.create(
                        image=ContentFile(image_bytes, name=generated_filename),
                        prompt=prompt
                    )
                    
                    # Return inline URL for immediate display + saved image record
                    return JsonResponse({
                        'url': image_b64_uri,
                        'saved_image': {
                            'id': generated_image.id,
                            'url': generated_image.image.url
                        }
                    })
            except Exception as save_error:
                print(f"Error saving image: {save_error}")
                # If saving fails, still return the generated image but log error
                return JsonResponse({'url': image_b64_uri})

            # Non-base64 response fallback (e.g., direct URL string)
            return JsonResponse({'url': image_b64_uri})

        except Exception as e:
            import traceback
            traceback.print_exc()
            status_code = 500
            if 'Overloaded' in str(e):
                status_code = 503
            return JsonResponse({'error': str(e)}, status=status_code)
    
    return JsonResponse({'error': 'Method not allowed'}, status=405)


@csrf_exempt
def generate_video_view(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        req_data = json.loads(request.body or '{}')
        prompt = req_data.get('prompt')
        config = req_data.get('config', {}) or {}
        reference_images = req_data.get('referenceImages', []) or []

        if not prompt:
            return JsonResponse({'error': 'Prompt is required'}, status=400)
            
        model_id = config.get('modelId', '')

        if model_id.startswith('kling'):
            from .services import generate_video_with_kling
            video_bytes, mime_type, used_model = generate_video_with_kling(
                prompt=prompt,
                config=config,
                reference_images=reference_images
            )
        else:
            video_bytes, mime_type, used_model = generate_video_with_veo(
                prompt=prompt,
                config=config,
                reference_images=reference_images
            )

        ext = 'mp4'
        if isinstance(mime_type, str):
            lower = mime_type.lower()
            if 'webm' in lower:
                ext = 'webm'
            elif 'quicktime' in lower or 'mov' in lower:
                ext = 'mov'

        filename = f"generated_video_{uuid.uuid4()}.{ext}"
        generated_video = GeneratedVideo.objects.create(
            video=ContentFile(video_bytes, name=filename),
            prompt=prompt
        )

        return JsonResponse({
            'url': generated_video.video.url,
            'mimeType': mime_type,
            'model': used_model,
            'saved_video': {
                'id': generated_video.id,
                'url': generated_video.video.url
            }
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def list_images(request):
    try:
        from django.core.paginator import Paginator
        from django.utils.dateparse import parse_datetime
        page = request.GET.get('page', 1)
        limit = int(request.GET.get('limit', 20))

        items = []
        for img in GeneratedImage.objects.all().only('id', 'image', 'prompt', 'created_at'):
            items.append({
                'key': f"img:{img.id}",
                'id': img.id,
                'media_type': 'image',
                'url': img.image.url,
                'prompt': img.prompt,
                'created_at': img.created_at.isoformat()
            })

        for vid in GeneratedVideo.objects.all().only('id', 'video', 'prompt', 'created_at'):
            items.append({
                'key': f"vid:{vid.id}",
                'id': vid.id,
                'media_type': 'video',
                'url': vid.video.url,
                'prompt': vid.prompt,
                'created_at': vid.created_at.isoformat()
            })

        items.sort(key=lambda x: parse_datetime(x['created_at']), reverse=True)

        paginator = Paginator(items, limit)
        page_obj = paginator.get_page(page)

        return JsonResponse({
            'images': list(page_obj.object_list),
            'page': page_obj.number,
            'num_pages': paginator.num_pages,
            'total': paginator.count
        })
    except Exception as e:
        print(f"Error listing images: {e}")
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def delete_image(request, image_id):
    if request.method == 'DELETE':
        try:
            image = get_object_or_404(GeneratedImage, id=image_id)
            image.image.delete() # Delete file
            image.delete() # Delete record
            return JsonResponse({'success': True})
        except Exception as e:
             return JsonResponse({'error': str(e)}, status=500)
    return JsonResponse({'error': 'Method not allowed'}, status=405)


@csrf_exempt
def delete_library_item(request, item_key):
    if request.method != 'DELETE':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        if ':' not in item_key:
            return JsonResponse({'error': 'Invalid item key'}, status=400)
        prefix, raw_id = item_key.split(':', 1)
        item_id = int(raw_id)

        if prefix == 'img':
            image = get_object_or_404(GeneratedImage, id=item_id)
            image.image.delete()
            image.delete()
            return JsonResponse({'success': True})

        if prefix == 'vid':
            video = get_object_or_404(GeneratedVideo, id=item_id)
            video.video.delete()
            video.delete()
            return JsonResponse({'success': True})

        return JsonResponse({'error': 'Unsupported item type'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
