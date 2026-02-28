import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'nanogen_django.settings')
django.setup()
from nanogen.models import GeneratedImage
print("Images:")
for img in GeneratedImage.objects.all().order_by('-created_at')[:10]:
    try:
        print(img.id, img.image.url)
    except Exception as e:
        print(img.id, 'ERROR:', e)
