from django.db import models

class GeneratedImage(models.Model):
    image = models.ImageField(upload_to='generated_images/')
    prompt = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Image {self.id} - {self.created_at}"

class SourceImage(models.Model):
    image = models.ImageField(upload_to='source_images/')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Source {self.id} - {self.created_at}"

class MidjourneyOption(models.Model):
    CATEGORY_CHOICES = [
        ('styles', 'Style / Look'),
        ('global_details', 'Global Details'),
        ('expression', 'Expression'),
        ('camera_angle', 'Camera Angle'),
        ('characteristics', 'Characteristics'),
        ('pose', 'Pose'),
        ('action', 'Action'),
        ('lighting', 'Lighting'),
        ('atmosphere', 'Atmosphere'),
        ('character_details', 'Character Details'),
        ('env_details', 'Environmental Details'),
    ]

    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES)
    label = models.CharField(max_length=100)
    value = models.CharField(max_length=100)
    order = models.IntegerField(default=0)

    class Meta:
        ordering = ['category', 'order', 'label']

    def __str__(self):
        return f"[{self.get_category_display()}] {self.label}"
