# Nanogen Application Guide

Nanogen is an advanced, Django-based AI media generation platform. It provides a comprehensive suite of tools for generating, composing, and modifying images and videos using state-of-the-art AI models. 

This guide is intended for end-users, developers, and Machine Context Protocol (MCP) agents to understand the system's capabilities, architecture, and interaction methods.

---

## 🚀 Core Features

### 1. AI Image Generation & Modification
Nanogen supports multiple modes of image creation and editing:
- **Generation:** Standard Text-to-Image generation using various AI models (e.g., Gemini imaging models). Supports customizable aspect ratios, resolutions, and prompt presets.
- **Composition (Outfit/Garment Swap):** Allows users to combine a base model image with a garment image, instructing the AI to seamlessly replace the clothing while preserving the model's identity, pose, and background.
- **Identity Swap:** Replaces the face/identity of a person in a source image with the identity of a target reference image, maintaining the original lighting and composition.
- **Editor Tools:** Includes interactive canvas tools like a Brush for masking and localized inpainting.

### 2. AI Video Generation
Nanogen integrates top-tier video generation models, including Google's **Veo** and Kuaishou's **Kling AI (v2.6 & v3.0)**.
- **Text-to-Video (T2V) & Image-to-Video (I2V):** Generate cinematic videos from text prompts or animate existing static images.
- **Granular Controls:** 
  - **Duration:** Selectable video lengths (e.g., 4s, 5s, 8s, 10s depending on the model).
  - **Kling Options:** Choose between `Standard` and `Pro` rendering modes.
  - **Camera Controls:** Apply sophisticated camera movements (Pan Left/Right, Tilt Up/Down, Zoom In/Out) directly via the UI or API.

### 3. Workflow Studio (Node-Based Pipeline Builder)
For advanced users and complex prompt chaining, the **Workflow Studio** provides a visual, node-based canvas (built via Drawflow).
- **Nodes Available:**
  - `Text Input`, `Image Input`, `Video Input`: Feed data into the pipeline.
  - `Prompt Agent`: Use LLMs to analyze text/knowledge and output structured prompts.
  - `Image Generator` / `Video Generator`: Trigger media generation logic with custom model dropdowns and parameter settings built directly into the node UI.
  - `Output Result`: Display the final generated media.
- **Interactivity:** Connect nodes to pass outputs (e.g., an LLM-refined prompt) as inputs to a Video Generator. Nodes feature inline viewing panels (Prompt View vs. Result View) and localized settings.

---

## 💻 For Developers & MCP Agents

Nanogen is built on a Django backend with a vanilla JavaScript frontend. It is designed to be highly modular.

### Architecture Overview
- **Backend:** Python / Django (`nanogen_django`). Handles routing, environment variable management, database models, and API requests to external AI providers.
- **Frontend:** Vanilla JS (`app.js`, HTML templates). Manages the visual canvas, state management, and asynchronous polling.
- **Services Layer (`nanogen/services.py`):** Encapsulates the core business logic for communicating with AI APIs (e.g., constructing Kling AI JWT tokens, mapping UI camera movements to API payloads, formatting base64 images, and polling task statuses).

### Key API Endpoints
MCPs or external services can interact with the generation pipelines via REST endpoints located in `nanogen/views.py`.

- `POST /api/generate-image`
  - **Payload:** `{"prompt": "...", "config": {...}, "referenceImages": [...]}`
  - **Response:** JSON containing the generated image URL or raw base64 data.

- `POST /api/generate-video`
  - **Payload:** 
    ```json
    {
      "prompt": "...",
      "config": {
        "modelId": "kling-v3",
        "durationSeconds": 10,
        "klingMode": "pro",
        "cameraMovement": "pan_left"
      },
      "referenceImages": ["base64_string_if_I2V"]
    }
    ```
  - **Behavior:** The backend automatically identifies the requested model. For asynchronous services like Kling AI, the backend submits the task, polls the external API until completion (handling `task_id` tracking), and returns the final `.mp4` URL.

### Local Database Models (`nanogen/models.py`)
- `GeneratedImage` & `GeneratedVideo`: Tracks historical generations.
- `WorkflowStore`: Saves custom Workflow Studio pipeline configurations as JSON for later retrieval.
- `MidjourneyOption`: Stores persistent UI option categories.

### Prompt Presets Handling
Prompt presets (e.g., cinematic styles, 9-grid storyboard layouts) are centrally defined in the frontend JavaScript as a `DEFAULT_PRESETS` constant. They are dynamically merged into the user's browser `localStorage`, allowing users to add custom local presets while always retaining access to the core platform presets.

---

## ⚙️ Environment Setup & Configuration

To run Nanogen, ensure following environment variables are securely defined (e.g., in a `.env` file):

- **Kling AI Integration:**
  - `KLING_ACCESS_KEY`
  - `KLING_SECRET_KEY`
- *(Add other provider keys if applicable, e.g., OpenAI API Key, Google Gemini API Key).*

### Running the Application
Ensure Python dependencies (e.g., `django`, `requests`, `PyJWT`) are installed.
```bash
python manage.py makemigrations
python manage.py migrate
python manage.py runserver
```

---
*Created for the Nanogen Project. This document serves as the primary context for human developers and MCPs extending the platform.*
