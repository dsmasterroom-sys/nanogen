window.onerror = function (msg, url, line, col, error) {
    // Ignore ResizeObserver errors which are common and harmless
    if (msg.includes('ResizeObserver')) return;
    alert("Runtime Error:\n" + msg + "\nLine: " + line);
    console.error("Global Error:", error);
};

document.addEventListener('DOMContentLoaded', () => {

    // Default Presets
    const DEFAULT_PRESETS = [
        {
            id: 'default-comp-1',
            name: '의상교체',
            text: "Change only the main clothing garments to strictly match the design, texture, and details of the provided clothing reference image. Replicate the attached outfit exactly. Crucially, preserve all original accessories intact (including bags, earrings, rings, jewelry, eyewear, etc.). Keep the original model's face, pose, hair, background, and lighting exactly the same. Seamless integration, photorealistic, 8k resolution.",
            mode: 'composition'
        },
        {
            id: 'default-gen-1',
            name: '9분할',
            text: "Acting as an award-winning cinematographer and storyboard artist, analyze the provided reference image to output a detailed textual plan for a 10-20 second cinematic sequence with a 4-beat arc—including scene analysis, story theme, cinematic approach, and precise definitions for 9-12 keyframes—and then finally generate a single high-resolution 3x3 master contact sheet grid image visualizing these keyframes while maintaining strict visual continuity of the original subject and environment with clear labels for each shot.",
            mode: 'generation'
        },
        {
            id: 'default-gen-2',
            name: '도심 쇼윈도',
            text: "A photorealistic medium shot of a woman with [INSERT FACE FEATURES HERE] wearing [INSERT NEW CLOTHING IMAGE DESCRIPTION HERE]. She is standing outside a luxury toy store window, lightly touching the glass. Her pose and facial expression remain unchanged. Inside the window, a stylized cartoon character doll with large round eyes mimics her exact pose. The background, lighting, and reflections remain exactly the same as the previous image: bright clear lighting, luxury street fashion atmosphere, realistic glass reflections. 8k resolution, cinematic.",
            mode: 'generation'
        },
        {
            id: 'default-swap-1',
            name: '모델변경',
            text: "Perform a seamless identity swap, replacing the original person with the identity and likeness of the provided attached model. Crucially, the new model must adopt the exact same pose, body proportions, composition, and placement within the frame as the original person. The entire background, lighting, shadows, and atmosphere must remain 100% identical to the original image. Photorealistic, high fidelity result.",
            mode: 'identity_swap'
        }
    ];

    // State
    let state = {
        mode: 'generation',
        prompt: '',
        config: {
            aspectRatio: '1:1',
            resolution: '1K',
            useGrounding: false,
            showBrushTools: true
        },
        referenceImage: null,
        composition: {
            model: null,
            garment: null
        },
        identitySwap: {
            scene: null,
            face: null
        },
        isGenerating: false,
        currentImage: null,
        isEditingPreset: false,
        pgPresets: [],
        isEditingPgPreset: false,
        promptGenAction: 'image', // toggle image/video
        // New: Generation Mode multi-image state
        generation: {
            model1: null,
            model2: null,
            object1: null,
            object2: null,
            reference1: null,
            reference2: null
        },
        promptGen: {
            model1: null,
            model2: null,
            object1: null,
            object2: null,
            reference1: null,
            reference2: null
        },
        maskImage: null,
        maskSource: null // e.g., 'composition-model'
    };

    let activeMaskTarget = null; // Temp storage for currently editing mask source

    // Elements
    const els = {
        modeBtns: document.querySelectorAll('.mode-btn'),
        aspectBtns: document.querySelectorAll('.aspect-btn'),
        resolutionBtns: document.querySelectorAll('.resolution-btn'),
        groundingToggle: document.getElementById('useGrounding'),
        brushToggle: document.getElementById('showBrushTools'),
        promptInput: document.getElementById('promptInput'),
        promptLength: document.getElementById('promptLength'),
        generateBtn: document.getElementById('generateBtn'),
        viewContainer: document.getElementById('viewContainer'),
        attachmentArea: document.getElementById('attachmentArea'),
        referenceInput: document.getElementById('referenceInput'),
        referencePreview: document.getElementById('referencePreview'),
        referencePreviewImg: document.getElementById('referencePreviewImg'),
        removeReferenceBtn: document.getElementById('removeReferenceBtn'),
        attachBtn: document.getElementById('attachBtn'),
        statusIndicator: document.getElementById('statusIndicator'),
        statusText: document.getElementById('statusText'),
        errorBanner: document.getElementById('errorBanner'),
        errorMessage: document.getElementById('errorMessage'),
        // Preset Elements
        presetModeLabel: document.getElementById('presetModeLabel'),
        addPresetBtn: document.getElementById('addPresetBtn'),
        presetEditForm: document.getElementById('presetEditForm'),
        editPresetId: document.getElementById('editPresetId'),
        editPresetName: document.getElementById('editPresetName'),
        editPresetText: document.getElementById('editPresetText'),
        cancelPresetEditBtn: document.getElementById('cancelPresetEditBtn'),
        savePresetBtn: document.getElementById('savePresetBtn'),
        presetsList: document.getElementById('presetsList'),
        pgTypeImageBtn: document.getElementById('pgTypeImageBtn'),
        pgTypeVideoBtn: document.getElementById('pgTypeVideoBtn'),
        addPgPresetBtn: document.getElementById('addPgPresetBtn'),
        pgPresetEditForm: document.getElementById('pgPresetEditForm'),
        editPgPresetId: document.getElementById('editPgPresetId'),
        editPgPresetName: document.getElementById('editPgPresetName'),
        editPgPresetText: document.getElementById('editPgPresetText'),
        cancelPgPresetEditBtn: document.getElementById('cancelPgPresetEditBtn'),
        savePgPresetBtn: document.getElementById('savePgPresetBtn'),
        pgInputPresetsList: document.getElementById('pgInputPresetsList')
    };

    // Helpers
    const showError = (msg) => {
        els.errorMessage.textContent = msg;
        els.errorBanner.classList.remove('hidden');
        setTimeout(() => els.errorBanner.classList.add('hidden'), 5000);
    };

    const safeCreateIcons = () => {
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            try {
                lucide.createIcons();
            } catch (e) {
                console.error("Lucide icon creation failed:", e);
            }
        }
    };

    const setGenerating = (generating) => {
        state.isGenerating = generating;
        if (generating) {
            els.generateBtn.disabled = true;
            els.generateBtn.innerHTML = '<div class="loader"></div>';
            els.statusIndicator.classList.add('animate-pulse');
            els.statusIndicator.classList.remove('bg-green-500');
            els.statusIndicator.classList.add('bg-yellow-500');
            els.statusText.textContent = 'Processing...';
        } else {
            els.generateBtn.disabled = false;
            els.generateBtn.innerHTML = '<span class="hidden md:inline">Generate</span><i data-lucide="sparkles" class="w-5 h-5"></i>';
            safeCreateIcons();
            els.statusIndicator.classList.remove('animate-pulse');
            els.statusIndicator.classList.remove('bg-yellow-500');
            els.statusIndicator.classList.add('bg-green-500');
            els.statusText.textContent = 'Ready';
        }
    };

    const fileToBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    };

    // --- Preset Logic ---
    const loadPresets = () => {
        try {
            const saved = localStorage.getItem('nanoGenPresets');
            if (saved) {
                state.presets = JSON.parse(saved);
            } else {
                state.presets = DEFAULT_PRESETS;
            }
        } catch (e) {
            console.error("Failed to load presets", e);
            state.presets = DEFAULT_PRESETS;
        }
    };

    const savePresets = () => {
        localStorage.setItem('nanoGenPresets', JSON.stringify(state.presets));
        renderPresets();
    };

    const renderPresets = () => {
        if (state.isEditingPreset) {
            els.presetsList.classList.add('hidden');
            els.presetEditForm.classList.remove('hidden');
        } else {
            els.presetsList.classList.remove('hidden');
            els.presetEditForm.classList.add('hidden');
        }

        // Update Label
        const modeLabels = { 'generation': 'Gen', 'composition': 'Comp', 'identity_swap': 'Swap', 'library': 'Lib', 'source_library': 'Src', 'prompt_gen': 'Prompt' };
        els.presetModeLabel.innerText = modeLabels[state.mode] || 'Gen';

        // Filter
        const filtered = state.presets.filter(p => p.mode === state.mode);
        els.presetsList.innerHTML = '';

        if (filtered.length === 0) {
            els.presetsList.innerHTML = '<div class="text-center py-4 text-xs text-zinc-600 italic">No presets for this mode.</div>';
            return;
        }

        filtered.forEach(preset => {
            const isActive = state.prompt === preset.text;
            const div = document.createElement('div');
            div.className = `group relative w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer ${isActive ? 'bg-yellow-500/10 border-yellow-500' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'}`;

            div.innerHTML = `
                <div class="mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isActive ? 'bg-yellow-500 border-yellow-500' : 'border-zinc-500'}">
                    ${isActive ? '<i data-lucide="check" class="w-3 h-3 text-black"></i>' : ''}
                </div>
                <div class="flex-1 min-w-0 pr-6">
                    <span class="block text-xs font-medium mb-1 ${isActive ? 'text-yellow-400' : 'text-zinc-300'}">${preset.name}</span>
                    <p class="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed">${preset.text}</p>
                </div>
                <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-800/80 backdrop-blur-sm rounded-md p-0.5">
                     <button class="edit-preset-btn p-1 text-zinc-400 hover:text-white hover:bg-zinc-600 rounded" title="Edit">
                        <i data-lucide="edit-2" class="w-3 h-3"></i>
                     </button>
                     <button class="delete-preset-btn p-1 text-zinc-400 hover:text-red-400 hover:bg-zinc-600 rounded" title="Delete">
                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                     </button>
                </div>
            `;

            // Click to select
            div.addEventListener('click', (e) => {
                // Ignore if clicked on buttons
                if (e.target.closest('button')) return;

                if (state.prompt === preset.text) {
                    state.prompt = '';
                } else {
                    state.prompt = preset.text;
                }
                els.promptInput.value = state.prompt;
                els.promptLength.textContent = state.prompt.length;
                renderPresets(); // re-render to update selection state
            });

            // Buttons
            const editBtn = div.querySelector('.edit-preset-btn');
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEditForm(preset);
            });

            const deleteBtn = div.querySelector('.delete-preset-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this preset?')) {
                    state.presets = state.presets.filter(p => p.id !== preset.id);
                    savePresets();
                }
            });

            els.presetsList.appendChild(div);
        });
        safeCreateIcons();
    };

    const openEditForm = (preset = null) => {
        state.isEditingPreset = true;
        if (preset) {
            els.editPresetId.value = preset.id;
            els.editPresetName.value = preset.name;
            els.editPresetText.value = preset.text;
        } else {
            els.editPresetId.value = '';
            els.editPresetName.value = '';
            els.editPresetText.value = '';
        }
        renderPresets();
    };

    const closeEditForm = () => {
        state.isEditingPreset = false;
        renderPresets();
    };

    const saveEditForm = () => {
        const id = els.editPresetId.value;
        const name = els.editPresetName.value.trim();
        const text = els.editPresetText.value.trim();

        if (!name || !text) {
            alert("Please provide both name and prompt text.");
            return;
        }

        if (id) {
            // Edit existing
            const idx = state.presets.findIndex(p => p.id === id);
            if (idx >= 0) {
                state.presets[idx] = { ...state.presets[idx], name, text };
            }
        } else {
            // Add new
            state.presets.push({
                id: Date.now().toString(),
                name,
                text,
                mode: state.mode
            });
        }
        savePresets();
        closeEditForm();
    };

    // Rendering Views
    const renderView = () => {
        if (state.currentImage) {
            renderResultView();
            return;
        }

        els.viewContainer.innerHTML = '';

        if (state.mode === 'generation') {
            renderGenerationView();
        } else if (state.mode === 'composition') {
            renderCompositionView();
        } else if (state.mode === 'identity_swap') {
            renderIdentitySwapView();
        } else if (state.mode === 'library') {
            renderLibraryView();
        } else if (state.mode === 'source_library') {
            renderSourceLibraryView();
        } else if (state.mode === 'prompt_gen') {
            renderPromptGenView();
        } else if (state.mode === 'workflow') {
            renderWorkflowView();
        }

        // Toggle visibility of the bottom prompt bar based on mode
        const promptBar = document.getElementById('bottomPromptBar');
        if (promptBar) {
            promptBar.style.display = (state.mode === 'workflow') ? 'none' : '';
        }

        safeCreateIcons();
        updateUI();
    };

    const renderResultView = () => {
        els.viewContainer.innerHTML = `
            <div class="relative group w-full h-full flex items-center justify-center flex-col gap-4">
               <button id="resetInputsBtn" class="absolute top-4 left-4 z-20 px-3 py-2 bg-zinc-800/80 backdrop-blur border border-zinc-700 rounded-lg text-xs font-medium text-zinc-300 hover:text-white flex items-center gap-2">
                 <i data-lucide="refresh-ccw" class="w-3 h-3"></i> Edit Inputs
               </button>
              <div class="relative max-w-full max-h-full rounded-lg overflow-hidden shadow-2xl border border-zinc-800 bg-zinc-900/50">
                 <img src="${state.currentImage}" class="max-w-full max-h-[calc(100vh-200px)] object-contain" />
                 <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-end">
                    <p class="text-sm text-zinc-300 line-clamp-2 max-w-[70%] drop-shadow-md font-medium">${state.prompt}</p>
                    <button id="downloadBtn" class="p-2 bg-white/10 backdrop-blur-md hover:bg-white/20 rounded-lg text-white border border-white/10" title="Download">
                      <i data-lucide="download" class="w-5 h-5"></i>
                    </button>
                 </div>
              </div>
            </div>
        `;

        document.getElementById('resetInputsBtn').addEventListener('click', () => {
            state.currentImage = null;
            renderView();
        });
        document.getElementById('downloadBtn').addEventListener('click', () => {
            const link = document.createElement('a');
            link.href = state.currentImage;
            link.download = `nanogen-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
        safeCreateIcons();
    };

    // --- Workflow Studio Logic ---
    const renderWorkflowView = () => {
        els.viewContainer.innerHTML = `
            <div class="w-full h-full relative" id="drawflow-container">
                <div id="drawflow" class="w-full h-full bg-[#09090b]"></div>
                
                <!-- Run Pipeline Button -->
                <div class="absolute top-4 right-4 z-10">
                    <button id="runWorkflowBtn" class="px-4 py-2 bg-gradient-to-r from-yellow-500 to-amber-600 border border-yellow-500/50 rounded-xl text-sm font-bold text-black hover:shadow-yellow-500/20 shadow-2xl flex items-center gap-2 transform hover:scale-105 transition-all">
                        <i data-lucide="play" class="w-5 h-5"></i> Run Pipeline
                    </button>
                </div>

                <!-- Floating Canvas Controls -->
                <div class="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 relative">
                    <!-- Overlay Menu (Hidden by default) -->
                    <div id="nodeAddOverlay" class="hidden absolute bottom-full left-1/2 -translate-x-1/2 mb-4 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 rounded-2xl p-4 shadow-2xl flex flex-col gap-4 animate-in fade-in zoom-in slide-in-from-bottom-4 duration-200 w-max">
                        
                        <!-- Inputs -->
                        <div>
                            <div class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2 px-1">Inputs</div>
                            <div class="flex gap-2">
                                <button id="addNodeTextInputBtn" class="flex flex-col items-center justify-center gap-1 p-2 hover:bg-zinc-800 rounded-xl transition-colors min-w-[64px] group">
                                    <div class="p-2 bg-zinc-500/10 group-hover:bg-zinc-500/20 rounded-full text-zinc-400 transition-colors"><i data-lucide="type" class="w-5 h-5"></i></div>
                                    <span class="text-[10px] font-medium text-zinc-400">Text</span>
                                </button>
                                <button id="addNodeImageInputBtn" class="flex flex-col items-center justify-center gap-1 p-2 hover:bg-zinc-800 rounded-xl transition-colors min-w-[64px] group">
                                    <div class="p-2 bg-emerald-500/10 group-hover:bg-emerald-500/20 rounded-full text-emerald-500 transition-colors"><i data-lucide="image" class="w-5 h-5"></i></div>
                                    <span class="text-[10px] font-medium text-zinc-400">Image</span>
                                </button>
                                <button id="addNodeVideoInputBtn" class="flex flex-col items-center justify-center gap-1 p-2 hover:bg-zinc-800 rounded-xl transition-colors min-w-[64px] group">
                                    <div class="p-2 bg-blue-500/10 group-hover:bg-blue-500/20 rounded-full text-blue-500 transition-colors"><i data-lucide="video" class="w-5 h-5"></i></div>
                                    <span class="text-[10px] font-medium text-zinc-400">Video</span>
                                </button>
                            </div>
                        </div>

                        <!-- Generators -->
                        <div>
                            <div class="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2 px-1">Generators</div>
                            <div class="flex gap-2">
                                <button id="addNodeGeneratorBtn" class="flex flex-col items-center justify-center gap-1 p-2 hover:bg-zinc-800 rounded-xl transition-colors min-w-[96px] group">
                                    <div class="p-2 bg-purple-500/10 group-hover:bg-purple-500/20 rounded-full text-purple-500 transition-colors"><i data-lucide="wand-sparkles" class="w-5 h-5"></i></div>
                                    <span class="text-[10px] font-medium text-zinc-400">Generator</span>
                                </button>
                            </div>
                        </div>

                        <!-- Outputs -->
                        <div>
                            <div class="flex gap-2">
                                <button id="addNodeOutputBtn" class="flex flex-col items-center justify-center gap-1 p-2 hover:bg-zinc-800 rounded-xl transition-colors w-full group">
                                    <div class="p-2 bg-yellow-500/10 group-hover:bg-yellow-500/20 rounded-full text-yellow-500 transition-colors"><i data-lucide="monitor-play" class="w-5 h-5"></i></div>
                                    <span class="text-[10px] font-bold text-yellow-500">Output Result</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Main Floating Add Button -->
                    <button id="floatingAddBtn" class="p-4 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-full shadow-2xl text-white transition-all transform hover:scale-110 active:scale-95 z-20 relative">
                        <i data-lucide="plus" class="w-6 h-6 transition-transform duration-300" id="floatingAddIcon"></i>
                    </button>
                </div>
            </div>
        `;

        // Ensure Drawflow is initialized
        requestAnimationFrame(() => {
            const container = document.getElementById('drawflow');
            if (!container) return;

            // Clean up old instance if exists
            if (window.editor) {
                container.innerHTML = '';
            }

            window.editor = new Drawflow(container);
            window.editor.start();

            // Toggle Overlay
            const overlay = document.getElementById('nodeAddOverlay');
            const icon = document.getElementById('floatingAddIcon');
            let isOverlayOpen = false;

            document.getElementById('floatingAddBtn').addEventListener('click', () => {
                isOverlayOpen = !isOverlayOpen;
                if (isOverlayOpen) {
                    overlay.classList.remove('hidden');
                    icon.classList.add('rotate-45');
                } else {
                    overlay.classList.add('hidden');
                    icon.classList.remove('rotate-45');
                }
            });

            // Close overlay when clicking outside (on canvas)
            document.getElementById('drawflow').addEventListener('click', () => {
                if (isOverlayOpen) {
                    isOverlayOpen = false;
                    overlay.classList.add('hidden');
                    icon.classList.remove('rotate-45');
                }
            });

            const hideOverlay = () => {
                isOverlayOpen = false;
                overlay.classList.add('hidden');
                icon.classList.remove('rotate-45');
            };

            // Auto-position nodes based on canvas center
            let spawnX = 150;
            let spawnY = 200;

            const incrementSpawn = () => {
                spawnX += 30;
                spawnY += 30;
                if (spawnX > 600) { spawnX = 150; spawnY = 200; }
            };

            // Add node creation events - Inputs
            document.getElementById('addNodeTextInputBtn').addEventListener('click', () => {
                const html = `
                    <div>
                        <div class="title-box border-b border-zinc-700 pb-2 mb-2 flex items-center gap-2"><i data-lucide="type" class="w-4 h-4 text-zinc-400"></i> Text Input</div>
                        <div class="box">
                            <textarea class="w-full bg-black/40 border border-zinc-700 rounded p-2 text-xs text-white h-20 outline-none custom-scrollbar node-input-text" placeholder="Enter text here..."></textarea>
                        </div>
                    </div>
                `;
                window.editor.addNode('text_input', 0, 1, spawnX, spawnY, 'text_input', {}, html);
                incrementSpawn();
                hideOverlay();
                safeCreateIcons();
            });

            document.getElementById('addNodeImageInputBtn').addEventListener('click', () => {
                const html = `
                    <div>
                        <div class="title-box border-b border-zinc-700 pb-2 mb-2 flex items-center gap-2"><i data-lucide="image" class="w-4 h-4 text-emerald-500"></i> Image Input</div>
                        <div class="box">
                            <div class="node-image-upload-area relative w-full h-24 border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center bg-zinc-900/50 hover:bg-zinc-800 transition-colors cursor-pointer overflow-hidden group">
                                <i data-lucide="upload-cloud" class="w-6 h-6 text-zinc-500 mb-1 group-hover:text-emerald-500 transition-colors"></i>
                                <span class="text-[10px] text-zinc-500 group-hover:text-emerald-400 transition-colors">Click to upload</span>
                                <img class="node-image-preview hidden absolute inset-0 w-full h-full object-cover">
                                <button class="node-image-remove hidden absolute top-1 right-1 p-1 bg-black/60 rounded text-red-400 hover:text-red-300 backdrop-blur-sm z-10"><i data-lucide="x" class="w-3 h-3"></i></button>
                                <input type="file" accept="image/*" class="hidden node-file-input">
                            </div>
                        </div>
                    </div>
                `;
                window.editor.addNode('image_input', 0, 1, spawnX, spawnY, 'image_input', { imageBase64: null }, html);
                incrementSpawn();
                hideOverlay();
                safeCreateIcons();
            });

            document.getElementById('addNodeVideoInputBtn').addEventListener('click', () => {
                const html = `
                    <div>
                        <div class="title-box border-b border-zinc-700 pb-2 mb-2 flex items-center gap-2"><i data-lucide="video" class="w-4 h-4 text-blue-500"></i> Video Input</div>
                        <div class="box">
                            <div class="node-video-upload-area relative w-full h-24 border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center bg-zinc-900/50 hover:bg-zinc-800 transition-colors cursor-pointer overflow-hidden group">
                                <i data-lucide="upload-cloud" class="w-6 h-6 text-zinc-500 mb-1 group-hover:text-blue-500 transition-colors"></i>
                                <span class="text-[10px] text-zinc-500 group-hover:text-blue-400 transition-colors">Click to upload</span>
                                <video class="node-video-preview hidden absolute inset-0 w-full h-full object-cover" controls></video>
                                <button class="node-video-remove hidden absolute top-1 right-1 p-1 bg-black/60 rounded text-red-400 hover:text-red-300 backdrop-blur-sm z-10"><i data-lucide="x" class="w-3 h-3"></i></button>
                                <input type="file" accept="video/mp4,video/webm" class="hidden node-file-input">
                            </div>
                        </div>
                    </div>
                `;
                window.editor.addNode('video_input', 0, 1, spawnX, spawnY, 'video_input', { videoUrl: null }, html);
                incrementSpawn();
                hideOverlay();
                safeCreateIcons();
            });

            // Add node creation events - Generator (Unified)
            document.getElementById('addNodeGeneratorBtn').addEventListener('click', () => {
                const html = `
                    <div>
                        <div class="title-box border-b border-zinc-700 pb-2 mb-2 flex items-center gap-2"><i data-lucide="wand-sparkles" class="w-4 h-4 text-purple-500"></i> Generator</div>
                        <div class="box">
                            <span class="text-[10px] text-zinc-500 mb-1 block">Output Type</span>
                            <select class="w-full bg-black/40 border border-zinc-700 rounded p-1 text-xs text-zinc-400 outline-none mb-2 node-output-type">
                                <option value="image">Image</option>
                                <option value="prompt">Prompt</option>
                                <option value="video">Video</option>
                            </select>
                            <span class="text-[10px] text-zinc-500 mb-1 block">Model (Image Mode)</span>
                            <select class="w-full bg-black/40 border border-zinc-700 rounded p-1 text-xs text-zinc-400 outline-none mb-2 node-input-model">
                                <option value="gemini-3-pro-image-preview">Gemini 3 Pro Image</option>
                                <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                            </select>
                            <span class="text-[10px] text-zinc-500 mb-1 block">Agent Prompt</span>
                            <textarea class="w-full bg-black/40 border border-zinc-700 rounded p-2 text-xs text-white h-16 outline-none custom-scrollbar node-agent-prompt mb-2" placeholder="Role/instruction for generator agent..."></textarea>
                            <span class="text-[10px] text-zinc-500 mb-1 block">Text Prompt</span>
                            <textarea class="w-full bg-black/40 border border-zinc-700 rounded p-2 text-xs text-white h-20 outline-none custom-scrollbar node-input-prompt mb-2" placeholder="Base prompt text..."></textarea>
                            <div class="node-result-container hidden mt-2 rounded overflow-hidden"></div>
                            <span class="text-[10px] text-zinc-500 italic mt-1 block NodeStatusStatus">Waiting...</span>
                        </div>
                    </div>
                `;
                window.editor.addNode('generator', 1, 1, spawnX + 250, spawnY, 'generator', {}, html);
                incrementSpawn();
                hideOverlay();
                safeCreateIcons();
            });

            // Add node creation events - Output
            document.getElementById('addNodeOutputBtn').addEventListener('click', () => {
                const html = `
                    <div>
                        <div class="title-box border-b border-zinc-700 pb-2 mb-2 flex items-center gap-2"><i data-lucide="monitor-play" class="w-4 h-4 text-yellow-500"></i> Output Result</div>
                        <div class="box min-w-[150px]">
                            <span class="text-[10px] text-zinc-500 mb-1 block">Final Result Display</span>
                            <div class="node-output-display min-h-[60px] bg-black/40 border border-zinc-700 rounded text-xs text-white p-2 break-all custom-scrollbar overflow-y-auto max-h-[150px] flex items-center justify-center text-zinc-600">No Data</div>
                        </div>
                    </div>
                `;
                // 1 Input (any), 0 Output
                window.editor.addNode('output_result', 1, 0, spawnX + 500, spawnY, 'output_result', {}, html);
                incrementSpawn();
                hideOverlay();
                safeCreateIcons();
            });
            // Run Workflow button logic
            document.getElementById('runWorkflowBtn').addEventListener('click', async () => {
                const exportData = window.editor.export();
                const nodes = exportData.drawflow.Home.data;
                const nodeKeys = Object.keys(nodes);

                if (nodeKeys.length === 0) return alert("Canvas is empty. Add some nodes first.");

                const getNodeDOM = (id) => document.getElementById('node-' + id);
                const nodeResults = {}; // Stores base64 images generated by each node
                let pending = new Set(nodeKeys);
                let iterationCount = 0;

                const runBtn = document.getElementById('runWorkflowBtn');
                const originalText = runBtn.innerHTML;
                runBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Running...';
                runBtn.disabled = true;

                try {
                    while (pending.size > 0 && iterationCount < 100) {
                        let executedInThisPass = false;

                        for (let id of Array.from(pending)) {
                            const node = nodes[id];
                            let canRun = true;
                            let referenceImages = [];

                            // Dependency Resolution
                            for (let inputKey in node.inputs) {
                                const inputConns = node.inputs[inputKey].connections;
                                for (let conn of inputConns) {
                                    const sourceNodeId = conn.node;
                                    if (!nodeResults[sourceNodeId]) {
                                        canRun = false;
                                        break;
                                    } else {
                                        referenceImages.push(nodeResults[sourceNodeId]);
                                    }
                                }
                                if (!canRun) break;
                            }

                            if (canRun) {
                                const dom = getNodeDOM(id);
                                if (!dom) {
                                    throw new Error(`Node DOM not found: ${id}`);
                                }
                                const resultContainer = dom.querySelector('.node-result-container');
                                if (resultContainer) {
                                    resultContainer.innerHTML = '<div class="text-xs text-yellow-500 animate-pulse text-center py-4 bg-zinc-800/50 rounded drop-shadow-sm border border-yellow-500/20">Processing...</div>';
                                    resultContainer.classList.remove('hidden');
                                }

                                let resultUrl = null;

                                // 1) Handle Inputs
                                if (node.name === 'text_input') {
                                    const promptEl = dom.querySelector('.node-input-text');
                                    nodeResults[id] = promptEl ? promptEl.value.trim() : '';
                                    resultUrl = 'done';
                                } else if (node.name === 'image_input') {
                                    const imgEl = dom.querySelector('.node-image-preview');
                                    if (imgEl && imgEl.src && imgEl.src !== window.location.href) {
                                        nodeResults[id] = imgEl.src;
                                        resultUrl = 'done';
                                    } else {
                                        throw new Error("Image node requires an uploaded image.");
                                    }
                                } else if (node.name === 'video_input') {
                                    nodeResults[id] = 'video_placeholder_data';
                                    resultUrl = 'done';
                                }
                                // 2) Handle Generators (Unified + backward compatible old node names)
                                else if (node.name === 'generator' || node.name === 'prompt_gen' || node.name === 'image_gen' || node.name === 'video_gen' || node.name === 'base_gen' || node.name === 'modifier') {
                                    const promptEl = dom.querySelector('.node-input-prompt') || { value: '' };
                                    const agentPromptEl = dom.querySelector('.node-agent-prompt') || { value: '' };
                                    const modelSelect = dom.querySelector('.node-input-model');
                                    const outputTypeEl = dom.querySelector('.node-output-type');

                                    // Legacy node compatibility: infer output type from old node names.
                                    let outputType = outputTypeEl ? outputTypeEl.value : 'image';
                                    if (node.name === 'prompt_gen') outputType = 'prompt';
                                    if (node.name === 'video_gen') outputType = 'video';
                                    if (node.name === 'image_gen' || node.name === 'base_gen' || node.name === 'modifier') outputType = 'image';

                                    const localPrompt = promptEl.value ? promptEl.value.trim() : '';
                                    const agentPrompt = agentPromptEl.value ? agentPromptEl.value.trim() : '';

                                    const refTexts = referenceImages.filter(v => typeof v === 'string' && !v.startsWith('data:image'));
                                    const refImgs = referenceImages.filter(v => typeof v === 'string' && v.startsWith('data:image'));

                                    // Agent + Text + upstream text를 합성한 최종 프롬프트
                                    const combinedPrompt = [agentPrompt, localPrompt, refTexts.join('\n')].filter(Boolean).join('\n\n');

                                    if (!combinedPrompt && (outputType === 'image' || outputType === 'prompt')) {
                                        throw new Error("Generator requires text input (Agent Prompt, Text Prompt, or upstream text).");
                                    }

                                    if (outputType === 'prompt') {
                                        const reqBody = {
                                            subject: combinedPrompt,
                                            presets: refTexts,
                                            referenceImages: refImgs,
                                            config: {},
                                            media_type: 'image'
                                        };
                                        const res = await fetch('/api/prompt/midjourney', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(reqBody)
                                        });
                                        const data = await res.json();
                                        if (data.prompt) {
                                            resultUrl = data.prompt;
                                            nodeResults[id] = resultUrl;
                                            if (resultContainer) {
                                                resultContainer.innerHTML = `<div class="p-2 bg-black/50 text-[10px] text-zinc-300 break-all leading-tight">${data.prompt}</div>`;
                                            }
                                        } else {
                                            throw new Error(data.error || 'Prompt generation failed');
                                        }
                                    } else if (outputType === 'image') {
                                        const reqBody = {
                                            prompt: combinedPrompt,
                                            config: { modelId: modelSelect ? modelSelect.value : 'gemini-3-pro-image-preview' }
                                        };
                                        if (refImgs.length > 0) reqBody.referenceImages = refImgs;

                                        const res = await fetch('/api/generate', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify(reqBody)
                                        });
                                        const data = await res.json();
                                        if (data.url) {
                                            resultUrl = data.url;
                                            nodeResults[id] = resultUrl;
                                        } else {
                                            throw new Error(data.error || 'Image generation failed');
                                        }
                                    } else if (outputType === 'video') {
                                        // Video backend is not available yet. Keep it explicit but usable in pipeline.
                                        resultUrl = `[VIDEO_SIMULATION]\n${combinedPrompt || 'No prompt provided.'}`;
                                        nodeResults[id] = resultUrl;
                                    } else {
                                        throw new Error(`Unsupported generator output type: ${outputType}`);
                                    }
                                }
                                // 3) Handle Output
                                else if (node.name === 'output_result') {
                                    const outDisplay = dom.querySelector('.node-output-display');
                                    if (!outDisplay) {
                                        throw new Error('Output node display element not found.');
                                    }
                                    if (referenceImages.length > 0) {
                                        const content = referenceImages[0];
                                        if (typeof content === 'string' && content.startsWith('data:image')) {
                                            outDisplay.innerHTML = `<img src="${content}" class="w-full h-auto object-contain rounded">`;
                                        } else {
                                            outDisplay.textContent = String(content ?? '');
                                        }
                                    } else {
                                        outDisplay.textContent = "No inputs provided.";
                                    }
                                    resultUrl = 'done';
                                }

                                // View Update
                                if (resultUrl === 'done') {
                                    if (resultContainer) resultContainer.classList.add('hidden');
                                    const titleBox = dom.querySelector('.title-box');
                                    if (titleBox) titleBox.classList.add('bg-emerald-900/40');
                                } else if (resultUrl && node.name !== 'output_result') {
                                    if (resultContainer) {
                                        if (typeof resultUrl === 'string' && resultUrl.startsWith('data:image')) {
                                            resultContainer.innerHTML = `<img src="${resultUrl}" class="w-full h-auto object-cover border border-zinc-700/50 rounded cursor-pointer hover:opacity-90 transition-opacity" onclick="window.openImageModal(this.src, '')">`;
                                        } else {
                                            resultContainer.innerHTML = `<div class="p-2 bg-black/50 text-[10px] text-zinc-300 break-all leading-tight">${String(resultUrl)}</div>`;
                                        }
                                    }
                                    const titleBox = dom.querySelector('.title-box');
                                    if (titleBox) titleBox.classList.add('bg-emerald-900/40');
                                } else {
                                    if (resultContainer) resultContainer.innerHTML = '<div class="text-xs text-red-500 py-2 text-center bg-red-900/20">Error Generated</div>';
                                }

                                pending.delete(id);
                                executedInThisPass = true;
                            }
                        }

                        if (!executedInThisPass) {
                            throw new Error("Unfulfilled inputs or circular dependency detected in node graph.");
                        }
                        iterationCount++;
                    }
                } catch (err) {
                    console.error("Workflow execution error:", err);
                    alert("Error Pipeline Execution: " + err.message);
                } finally {
                    runBtn.innerHTML = originalText;
                    runBtn.disabled = false;
                    safeCreateIcons();
                }
            });

            // Handle file upload events via delegation for dynamic Input Nodes
            document.getElementById('drawflow').addEventListener('change', (e) => {
                const target = e.target;
                if (target.classList.contains('node-file-input')) {
                    const file = target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const box = target.closest('.box');
                        const isVideo = target.accept && target.accept.includes('video');

                        if (isVideo) {
                            const videoEl = box.querySelector('.node-video-preview');
                            if (videoEl) {
                                videoEl.src = event.target.result;
                                videoEl.classList.remove('hidden');
                                const removeBtn = box.querySelector('.node-video-remove');
                                if (removeBtn) removeBtn.classList.remove('hidden');
                            }
                        } else {
                            const imgEl = box.querySelector('.node-image-preview');
                            if (imgEl) {
                                imgEl.src = event.target.result;
                                imgEl.classList.remove('hidden');
                                const removeBtn = box.querySelector('.node-image-remove');
                                if (removeBtn) removeBtn.classList.remove('hidden');
                            }
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });

            document.getElementById('drawflow').addEventListener('click', (e) => {
                // Click to trigger input
                const uploadArea = e.target.closest('.node-image-upload-area, .node-video-upload-area');
                if (uploadArea && e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
                    const input = uploadArea.querySelector('.node-file-input');
                    if (input) input.click();
                }

                // Click to remove
                const removeBtn = e.target.closest('.node-image-remove, .node-video-remove');
                if (removeBtn) {
                    e.stopPropagation();
                    const box = removeBtn.closest('.box');
                    if (removeBtn.classList.contains('node-image-remove')) {
                        const imgEl = box.querySelector('.node-image-preview');
                        if (imgEl) {
                            imgEl.src = '';
                            imgEl.classList.add('hidden');
                        }
                    } else {
                        const videoEl = box.querySelector('.node-video-preview');
                        if (videoEl) {
                            videoEl.src = '';
                            videoEl.classList.add('hidden');
                        }
                    }
                    removeBtn.classList.add('hidden');
                    const input = box.querySelector('.node-file-input');
                    if (input) input.value = ''; // Reset input
                }
            });

            safeCreateIcons();
        });
    };

        // --- Prompt Gen Logic ---
        // 5-Step Structure according to Expert Guide
        // --- Prompt Gen Logic ---
        // 5-Step Structure according to Expert Guide
        let MIDJOURNEY_PRESETS = {
            styles: [], global_details: [], expression: [], camera_angle: [],
            characteristics: [], pose: [], action: [], lighting: [],
            atmosphere: [], character_details: [], env_details: []
        };

        const renderPromptGenPresets = () => {
            const list = els.pgInputPresetsList;
            if (!list) return;

            if (state.isEditingPgPreset) {
                list.classList.add('hidden');
                els.pgPresetEditForm.classList.remove('hidden');
            } else {
                list.classList.remove('hidden');
                els.pgPresetEditForm.classList.add('hidden');
            }

            list.innerHTML = '';
            if (state.pgPresets.length === 0) {
                list.innerHTML = '<div class="text-center py-4 text-xs text-zinc-600 italic">No input presets. Add one.</div>';
                return;
            }

            state.pgPresets.forEach(preset => {
                const isActive = preset.active || false;

                const btn = document.createElement('div');
                btn.className = `pg-input-preset-btn w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all cursor-pointer group relative ${isActive ? 'bg-yellow-500/10 border-yellow-500 active' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'}`;
                btn.dataset.text = preset.text;
                btn.dataset.value = preset.text; // For generateMjPrompt payload

                btn.innerHTML = `
                <div class="w-4 h-4 rounded border flex items-center justify-center shrink-0 icon-container transition-colors ${isActive ? 'bg-yellow-500 border-yellow-500' : 'border-zinc-500'}">
                    ${isActive ? '<i data-lucide="check" class="w-3 h-3 text-black"></i>' : ''}
                </div>
                <div class="flex-1 min-w-0 pr-6">
                    <span class="block text-xs font-medium mb-1 ${isActive ? 'text-yellow-400' : 'text-zinc-300'} pointer-events-none">${preset.name}</span>
                    <p class="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed pointer-events-none">${preset.text}</p>
                </div>
                <!-- Action Buttons Overlay -->
                <div class="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-800/80 backdrop-blur-sm rounded-md p-0.5 z-10">
                    <button class="edit-pg-preset-btn p-1 text-zinc-400 hover:text-white hover:bg-zinc-600 rounded" title="Edit">
                        <i data-lucide="edit-2" class="w-3 h-3"></i>
                    </button>
                    <button class="delete-pg-preset-btn p-1 text-zinc-400 hover:text-red-400 hover:bg-zinc-600 rounded" title="Delete">
                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                    </button>
                </div>
            `;

                btn.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    preset.active = !preset.active;
                    savePgPresets();
                });

                // Edit
                const editBtn = btn.querySelector('.edit-pg-preset-btn');
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPgEditForm(preset);
                });

                // Delete
                const deleteBtn = btn.querySelector('.delete-pg-preset-btn');
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm('Delete this input preset?')) {
                        state.pgPresets = state.pgPresets.filter(p => p.id !== preset.id);
                        savePgPresets();
                    }
                });

                list.appendChild(btn);
            });
            safeCreateIcons();
        };

        const openPgEditForm = (preset = null) => {
            state.isEditingPgPreset = true;
            if (preset) {
                els.editPgPresetId.value = preset.id;
                els.editPgPresetName.value = preset.name;
                els.editPgPresetText.value = preset.text;
            } else {
                els.editPgPresetId.value = '';
                els.editPgPresetName.value = '';
                els.editPgPresetText.value = '';
            }
            renderPromptGenPresets();
        };

        const closePgEditForm = () => {
            state.isEditingPgPreset = false;
            renderPromptGenPresets();
        };

        const savePgEditForm = () => {
            const id = els.editPgPresetId.value;
            const name = els.editPgPresetName.value.trim();
            const text = els.editPgPresetText.value.trim();

            if (!name || !text) {
                alert("Please provide both name and prompt text.");
                return;
            }

            if (id) {
                const idx = state.pgPresets.findIndex(p => p.id === id);
                if (idx >= 0) {
                    state.pgPresets[idx] = { ...state.pgPresets[idx], name, text };
                }
            } else {
                state.pgPresets.push({
                    id: Date.now().toString(),
                    name,
                    text,
                    active: false
                });
            }
            savePgPresets();
            closePgEditForm();
        };

        const loadPgPresets = () => {
            try {
                const saved = localStorage.getItem('nanoGenPgPresets');
                if (saved) {
                    state.pgPresets = JSON.parse(saved);
                } else {
                    state.pgPresets = [];
                }
            } catch (e) {
                console.error("Failed to load PG presets", e);
                state.pgPresets = [];
            }
        };

        const savePgPresets = () => {
            localStorage.setItem('nanoGenPgPresets', JSON.stringify(state.pgPresets));
            renderPromptGenPresets();
        };

        // Replace loadMjPresets content
        const loadMjPresets = async () => {
            try {
                const res = await fetch('/api/prompt/presets');
                const data = await res.json();
                if (data && !data.error) {
                    MIDJOURNEY_PRESETS = data;
                    // We no longer strictly need this for rendering the prompt gen sidebar, 
                    // but keep it for legacy compatibility
                    if (state.mode === 'prompt_gen') {
                        renderPromptGenView();
                    }
                }
            } catch (e) {
                console.error("Failed to load MJ presets", e);
            }
        };

        // Load presets on startup
        loadMjPresets();
        loadPgPresets();
        renderPromptGenPresets();

        window.promptGenState = {
            species: 'Human',
            animalType: '',
            gender: 'Female',
            subject: '',
            styles: [],
            global_details: [],
            characteristics: [],
            expression: '',
            camera_angle: '',
            pose: '',
            action: '',
            lighting: '',
            atmosphere: [],
            character_details: [],
            env_details: []
        };

        window.toggleMjOption = (category, value) => {
            const list = window.promptGenState[category];
            const idx = list.indexOf(value);
            if (idx > -1) {
                list.splice(idx, 1);
            } else {
                if (list.length >= 3) return;
                list.push(value);
            }
            renderPromptGenView();
        };

        window.toggleSpecies = (val) => {
            window.promptGenState.species = val;
            renderPromptGenView();
        };

        window.addMjOption = async (category) => {
            const label = prompt("Enter new option name:");
            if (!label) return;

            try {
                const res = await fetch('/api/prompt/option/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ category, label })
                });
                const data = await res.json();
                if (data.success) {
                    await loadMjPresets();
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                alert('Network error: ' + e);
            }
        };

        window.deleteMjOption = async (id) => {
            if (!confirm('Delete this option?')) return;
            try {
                const res = await fetch(`/api/prompt/option/${id}/delete`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    await loadMjPresets();
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                alert('Network error: ' + e);
            }
        };

        const renderPromptGenView = () => {
            // Render 3-column upload view similar to Generation View
            els.viewContainer.innerHTML = `
            <div class="flex flex-col h-full w-full">
                <!-- Upload Area (Three Columns: MODEL, OBJECT, REFERENCE) -->
                <div class="flex-1 p-6 flex items-center justify-center w-full bg-zinc-950/30">
                    <div class="w-full max-w-7xl h-full flex flex-row gap-6">
                        
                        <!-- MODEL Column -->
                        <div class="flex-1 flex flex-col min-h-0 bg-zinc-900/40 rounded-xl border border-zinc-800/80 p-4 shadow-sm backdrop-blur-sm">
                            <div class="flex items-center gap-2 mb-3 px-1 text-zinc-300">
                                <i data-lucide="user" class="w-4 h-4 text-emerald-500"></i>
                                <span class="text-sm font-bold tracking-widest uppercase">MODEL</span>
                            </div>
                            <div class="flex-1 flex flex-col gap-3 min-h-0">
                                 ${createUploadBox('pg-model1-upload', 'Model 1', 'image', 'promptGen', 'model1', 'Main Character')}
                                 ${createUploadBox('pg-model2-upload', 'Model 2', 'image', 'promptGen', 'model2', 'Secondary Character')}
                            </div>
                        </div>

                        <!-- OBJECT Column -->
                        <div class="flex-1 flex flex-col min-h-0 bg-zinc-900/40 rounded-xl border border-zinc-800/80 p-4 shadow-sm backdrop-blur-sm">
                            <div class="flex items-center gap-2 mb-3 px-1 text-zinc-300">
                                <i data-lucide="box" class="w-4 h-4 text-purple-500"></i>
                                <span class="text-sm font-bold tracking-widest uppercase">OBJECT</span>
                            </div>
                            <div class="flex-1 flex flex-col gap-3 min-h-0">
                                 ${createUploadBox('pg-obj1-upload', 'Object 1', 'layers', 'promptGen', 'object1', 'Main Item')}
                                 ${createUploadBox('pg-obj2-upload', 'Object 2', 'layers', 'promptGen', 'object2', 'Secondary Item')}
                            </div>
                        </div>

                        <!-- REFERENCE Column -->
                        <div class="flex-1 flex flex-col min-h-0 bg-zinc-900/40 rounded-xl border border-zinc-800/80 p-4 shadow-sm backdrop-blur-sm">
                            <div class="flex items-center gap-2 mb-3 px-1 text-zinc-300">
                                <i data-lucide="image" class="w-4 h-4 text-blue-500"></i>
                                <span class="text-sm font-bold tracking-widest uppercase">REFERENCE</span>
                            </div>
                            <div class="flex-1 flex flex-col gap-3 min-h-0">
                                 ${createUploadBox('pg-ref1-upload', 'Reference 1', 'image', 'promptGen', 'reference1', 'Style / Pose')}
                                 ${createUploadBox('pg-ref2-upload', 'Reference 2', 'image', 'promptGen', 'reference2', 'Background / Composition')}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        `;

            // Attach listeners for all 6 upload boxes
            attachUploadListeners('pg-model1-upload', 'promptGen', 'model1');
            attachUploadListeners('pg-model2-upload', 'promptGen', 'model2');
            attachUploadListeners('pg-obj1-upload', 'promptGen', 'object1');
            attachUploadListeners('pg-obj2-upload', 'promptGen', 'object2');
            attachUploadListeners('pg-ref1-upload', 'promptGen', 'reference1');
            attachUploadListeners('pg-ref2-upload', 'promptGen', 'reference2');

            safeCreateIcons();
        };

        window.generateMjPrompt = async () => {
            const conceptInput = document.getElementById('pgConceptInput')?.value || '';
            const activePresets = Array.from(document.querySelectorAll('.pg-input-preset-btn.active'))
                .map(btn => btn.dataset.value);

            // Gather images
            const refImages = [];
            if (state.promptGen.model1) refImages.push(state.promptGen.model1);
            if (state.promptGen.model2) refImages.push(state.promptGen.model2);
            if (state.promptGen.object1) refImages.push(state.promptGen.object1);
            if (state.promptGen.object2) refImages.push(state.promptGen.object2);
            if (state.promptGen.reference1) refImages.push(state.promptGen.reference1);
            if (state.promptGen.reference2) refImages.push(state.promptGen.reference2);

            if (!conceptInput && refImages.length === 0 && activePresets.length === 0) {
                alert('Please provide some concept text, presets, or images.');
                return;
            }

            setGenerating(true);

            try {
                const response = await fetch('/api/prompt/midjourney', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subject: conceptInput,
                        presets: activePresets,
                        referenceImages: refImages,
                        config: state.config,
                        media_type: state.promptGenAction
                    })
                });
                const data = await response.json();

                if (data.prompt) {
                    els.promptInput.value = data.prompt;
                    state.prompt = data.prompt;
                    els.promptLength.textContent = state.prompt.length;
                } else {
                    showError("Error: " + (data.error || 'Unknown error'));
                }
            } catch (e) {
                showError("Network Error: " + e.message);
            } finally {
                setGenerating(false);
                safeCreateIcons();
            }
        };


        const renderCompositionView = () => {
            els.viewContainer.innerHTML = `
            <div class="w-full h-full flex flex-col p-6 items-center justify-center">
                <div class="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8">
                    <!-- Model -->
                     <div class="flex flex-col gap-2">
                        <span class="text-sm font-semibold text-zinc-300">Target Model (Person)</span>
                         ${createUploadBox('comp-model-upload', 'Model Image', 'user', 'composition', 'model', 'Upload the main subject')}
                    </div>
                    <!-- Garment -->
                     <div class="flex flex-col gap-2">
                        <span class="text-sm font-semibold text-zinc-300">Target Garment (Clothing)</span>
                         ${createUploadBox('comp-garment-upload', 'Garment Image', 'shirt', 'composition', 'garment', 'Upload clothing to transfer')}
                    </div>
                </div>
            </div>
        `;
            // Re-attach listeners for new inputs
            attachUploadListeners('comp-model-upload', 'composition', 'model');
            attachUploadListeners('comp-garment-upload', 'composition', 'garment');
        };

        const renderIdentitySwapView = () => {
            els.viewContainer.innerHTML = `
            <div class="w-full h-full flex flex-col p-6 items-center justify-center">
                <div class="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8">
                    <!-- Source Scene -->
                     <div class="flex flex-col gap-2">
                        <span class="text-sm font-semibold text-zinc-300">Base Image (Scene)</span>
                         ${createUploadBox('swap-scene-upload', 'Base Image', 'image', 'identitySwap', 'scene', 'Upload the base photo')}
                    </div>
                    <!-- Source Face -->
                     <div class="flex flex-col gap-2">
                        <span class="text-sm font-semibold text-zinc-300">Source Face</span>
                         ${createUploadBox('swap-face-upload', 'Face Image', 'user', 'identitySwap', 'face', 'Upload face to swap in')}
                    </div>
                </div>
            </div>
        `;
            attachUploadListeners('swap-scene-upload', 'identitySwap', 'scene');
            attachUploadListeners('swap-face-upload', 'identitySwap', 'face');
            attachUploadListeners('swap-scene-upload', 'identitySwap', 'scene');
            attachUploadListeners('swap-face-upload', 'identitySwap', 'face');
        };

        // New: Render Generation View (Similar to Composition)
        // New: Render Generation View (Similar to Composition)
        const renderGenerationView = () => {
            const showResult = !!state.currentImage;

            els.viewContainer.innerHTML = `
            <div class="flex flex-col h-full w-full">
                <!-- Result Area (only if generated) -->
                ${showResult ? `
                    <div class="flex-1 min-h-0 flex flex-col p-6 bg-zinc-950/50 border-b border-zinc-800">
                        <div class="flex justify-between items-center mb-4">
                            <span class="text-sm font-medium text-zinc-400 uppercase tracking-wider">Generated Result</span>
                            <div class="flex gap-2">
                                <button onclick="window.saveToLibrary()" class="text-xs bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg border border-zinc-700 flex items-center gap-2 transition-colors">
                                    <i data-lucide="save" class="w-3 h-3"></i> Save to Library
                                </button>
                                <a href="${state.currentImage}" download="generated.png" class="text-xs bg-yellow-600 hover:bg-yellow-500 text-black font-semibold px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors">
                                    <i data-lucide="download" class="w-3 h-3"></i> Download
                                </a>
                            </div>
                        </div>
                        <div class="flex-1 relative rounded-xl overflow-hidden border border-zinc-800 bg-black group">
                             <img src="${state.currentImage}" class="w-full h-full object-contain">
                             <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none"></div>
                        </div>
                    </div>
                ` : ''}

                <!-- Upload Area (Three Columns: MODEL, OBJECT, REFERENCE) -->
                <div class="${showResult ? 'h-[250px] min-h-[200px]' : 'flex-1'} p-6 flex items-center justify-center w-full bg-zinc-950/30">
                    <div class="w-full max-w-7xl h-full flex flex-row gap-6">
                        
                        <!-- MODEL Column -->
                        <div class="flex-1 flex flex-col min-h-0 bg-zinc-900/40 rounded-xl border border-zinc-800/80 p-4 shadow-sm backdrop-blur-sm">
                            <div class="flex items-center gap-2 mb-3 px-1 text-zinc-300">
                                <i data-lucide="user" class="w-4 h-4 text-emerald-500"></i>
                                <span class="text-sm font-bold tracking-widest uppercase">MODEL</span>
                            </div>
                            <div class="flex-1 flex flex-col gap-3 min-h-0">
                                 ${createUploadBox('gen-model1-upload', 'Model 1', 'image', 'generation', 'model1', 'Main Character')}
                                 ${createUploadBox('gen-model2-upload', 'Model 2', 'image', 'generation', 'model2', 'Secondary Character')}
                            </div>
                        </div>

                        <!-- OBJECT Column -->
                        <div class="flex-1 flex flex-col min-h-0 bg-zinc-900/40 rounded-xl border border-zinc-800/80 p-4 shadow-sm backdrop-blur-sm">
                            <div class="flex items-center gap-2 mb-3 px-1 text-zinc-300">
                                <i data-lucide="box" class="w-4 h-4 text-purple-500"></i>
                                <span class="text-sm font-bold tracking-widest uppercase">OBJECT</span>
                            </div>
                            <div class="flex-1 flex flex-col gap-3 min-h-0">
                                 ${createUploadBox('gen-obj1-upload', 'Object 1', 'layers', 'generation', 'object1', 'Main Item')}
                                 ${createUploadBox('gen-obj2-upload', 'Object 2', 'layers', 'generation', 'object2', 'Secondary Item')}
                            </div>
                        </div>

                        <!-- REFERENCE Column -->
                        <div class="flex-1 flex flex-col min-h-0 bg-zinc-900/40 rounded-xl border border-zinc-800/80 p-4 shadow-sm backdrop-blur-sm">
                            <div class="flex items-center gap-2 mb-3 px-1 text-zinc-300">
                                <i data-lucide="image" class="w-4 h-4 text-blue-500"></i>
                                <span class="text-sm font-bold tracking-widest uppercase">REFERENCE</span>
                            </div>
                            <div class="flex-1 flex flex-col gap-3 min-h-0">
                                 ${createUploadBox('gen-ref1-upload', 'Reference 1', 'image', 'generation', 'reference1', 'Style / Pose')}
                                 ${createUploadBox('gen-ref2-upload', 'Reference 2', 'image', 'generation', 'reference2', 'Background / Composition')}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        `;

            attachUploadListeners('gen-model1-upload', 'generation', 'model1');
            attachUploadListeners('gen-model2-upload', 'generation', 'model2');
            attachUploadListeners('gen-obj1-upload', 'generation', 'object1');
            attachUploadListeners('gen-obj2-upload', 'generation', 'object2');
            attachUploadListeners('gen-ref1-upload', 'generation', 'reference1');
            attachUploadListeners('gen-ref2-upload', 'generation', 'reference2');
        };

        // Library Pagination State
        window.libraryState = { page: 1, hasMore: true, isLoading: false };

        const renderLibraryView = async (append = false) => {
            if (!append) {
                window.libraryState = { page: 1, hasMore: true, isLoading: false };
                els.viewContainer.innerHTML = '<div class="w-full h-full p-6 flex flex-col items-center"><div id="masonryGrid" class="w-full columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4"></div><div id="loadMoreTrigger" class="py-8"><div class="loader"></div></div></div>';
            }

            if (window.libraryState.isLoading || !window.libraryState.hasMore) return;
            window.libraryState.isLoading = true;

            try {
                const res = await fetch(`/api/images?page=${window.libraryState.page}&limit=20`);
                const data = await res.json();
                const grid = document.getElementById('masonryGrid');
                const trigger = document.getElementById('loadMoreTrigger');

                if (data.images && data.images.length > 0) {
                    const html = data.images.map(img => {
                        const safePrompt = img.prompt ? img.prompt.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ') : '';
                        return `
                            <div class="relative group rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900 cursor-pointer break-inside-avoid shadow-sm hover:shadow-yellow-500/10 transition-all duration-300 transform hover:-translate-y-1" onclick="window.openImageModal('${img.url}', '${safePrompt}')">
                                <div class="absolute inset-0 flex items-center justify-center bg-zinc-900" id="skeleton-${img.id}">
                                    <i data-lucide="image" class="w-8 h-8 text-zinc-700 animate-pulse"></i>
                                </div>
                                <img src="${img.url}" onload="document.getElementById('skeleton-${img.id}')?.remove(); this.classList.remove('opacity-0')" class="w-full h-auto object-cover bg-black opacity-0 transition-opacity duration-500">
                                
                                <!-- Hover Overlay for Actions -->
                                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                                <!-- Bottom Right Actions -->
                                <div class="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10" onclick="event.stopPropagation()">
                                    <button onclick="window.downloadImage('${img.url}')" class="p-1.5 bg-zinc-800/90 hover:bg-zinc-700 text-white rounded-md border border-zinc-600 backdrop-blur-sm shadow-sm" title="Download">
                                        <i data-lucide="download" class="w-4 h-4"></i>
                                    </button>
                                    <button onclick="window.deleteImage(${img.id})" class="p-1.5 bg-red-900/80 hover:bg-red-800 text-red-100 rounded-md border border-red-800 backdrop-blur-sm shadow-sm" title="Delete">
                                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                                    </button>
                                </div>
                            </div>
                        `}).join('');

                    if (grid) {
                        grid.insertAdjacentHTML('beforeend', html);
                    }

                    // Pagination check
                    if (window.libraryState.page >= data.num_pages) {
                        window.libraryState.hasMore = false;
                        if (trigger) trigger.innerHTML = '<span class="text-zinc-600 text-xs">No more images</span>';
                    } else {
                        window.libraryState.page++;
                        if (trigger) trigger.innerHTML = '<button onclick="window.loadMoreLibrary()" class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">Load More</button>';
                    }
                } else if (!append) {
                    els.viewContainer.innerHTML = `
                    <div class="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
                        <i data-lucide="image" class="w-12 h-12 opacity-20"></i>
                        <p>No images generated yet.</p>
                    </div>
                 `;
                }
            } catch (e) {
                console.error(e);
                if (!append) els.viewContainer.innerHTML = `<div class="text-red-500">Failed to load library: ${e.message}</div>`;
            } finally {
                window.libraryState.isLoading = false;
                safeCreateIcons();
            }
        };

        window.loadMoreLibrary = () => {
            const trigger = document.getElementById('loadMoreTrigger');
            if (trigger) trigger.innerHTML = '<div class="loader"></div>';
            renderLibraryView(true);
        };

        window.openImageModal = (url, prompt) => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-4 opacity-0 transition-opacity duration-300';

            // Use a wrapper to trigger animation after DOM insertion
            setTimeout(() => modal.classList.remove('opacity-0'), 10);

            modal.onclick = () => {
                modal.classList.add('opacity-0');
                setTimeout(() => modal.remove(), 300);
            };

            modal.innerHTML = `
            <div class="relative w-full max-w-7xl h-full flex flex-col items-center justify-center p-4 md:p-8" onclick="event.stopPropagation()">
                <!-- Image Container with Skeleton -->
                <div class="relative w-full h-full flex items-center justify-center mb-4 min-h-[50vh]">
                     <div id="modalSkeleton" class="absolute inset-0 flex items-center justify-center">
                         <div class="w-12 h-12 rounded-full border-4 border-zinc-800 border-t-yellow-500 animate-spin"></div>
                     </div>
                     <img src="${url}" onload="document.getElementById('modalSkeleton').remove(); this.classList.remove('opacity-0')" class="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl border border-zinc-800 opacity-0 transition-opacity duration-500">
                </div>
                
                <!-- Close Button -->
                <button onclick="this.closest('.fixed').onclick()" class="absolute top-4 right-4 md:top-8 md:right-8 p-3 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors z-10 backdrop-blur-sm border border-white/10">
                    <i data-lucide="x" class="w-6 h-6"></i>
                </button>
                
                <!-- Prompt Box -->
                ${prompt ? `
                <div class="absolute bottom-4 left-4 right-4 md:bottom-8 md:left-auto md:right-auto md:max-w-3xl w-full bg-zinc-900/90 backdrop-blur-md px-6 py-4 rounded-xl border border-zinc-700/50 shadow-2xl transform translate-y-4 opacity-0 animate-[slideUp_0.3s_ease-out_0.2s_forwards]">
                    <div class="flex justify-between items-start gap-4">
                        <p class="text-sm md:text-base text-zinc-300 max-h-32 overflow-y-auto custom-scrollbar font-medium leading-relaxed">${prompt}</p>
                        <button onclick="window.downloadImage('${url}')" class="shrink-0 p-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 rounded-lg transition-colors" title="Download Image">
                            <i data-lucide="download" class="w-5 h-5"></i>
                        </button>
                    </div>
                </div>
                ` : ''}
            </div>
        `;

            // Add required keyframe for slideUp if not exists
            if (!document.getElementById('modalKeyframes')) {
                const style = document.createElement('style');
                style.id = 'modalKeyframes';
                style.innerHTML = `
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `;
                document.head.appendChild(style);
            }

            document.body.appendChild(modal);
            safeCreateIcons();
        };

        window.downloadImage = (url) => {
            const link = document.createElement('a');
            link.href = url;
            link.download = `nanogen-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };

        window.deleteImage = async (id) => {
            if (!confirm('Are you sure you want to delete this image?')) return;
            try {
                await fetch(`/api/images/${id}/delete`, { method: 'DELETE' });
                renderLibraryView();
            } catch (e) {
                alert('Failed to delete image');
            }
        };


        // --- Source Library Logic ---

        // Source Library Pagination State
        window.sourceLibraryState = { page: 1, hasMore: true, isLoading: false };

        const renderSourceLibraryView = async (append = false) => {
            if (!append) {
                window.sourceLibraryState = { page: 1, hasMore: true, isLoading: false };
                els.viewContainer.innerHTML = `
                <div class="w-full h-full flex flex-col p-6 max-w-6xl mx-auto">
                     <div class="flex justify-between items-center mb-6 shrink-0">
                        <h2 class="text-xl font-bold text-white flex items-center gap-2">
                             <i data-lucide="folder-open" class="w-5 h-5 text-yellow-500"></i> Source Library
                        </h2>
                        <button onclick="window.triggerSourceUpload()" class="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-lg flex items-center gap-2">
                            <i data-lucide="upload" class="w-4 h-4"></i> Upload New Image
                        </button>
                        <input type="file" id="sourceUploadInput" class="hidden" accept="image/*">
                     </div>
                     <div class="flex-1 overflow-y-auto custom-scrollbar min-h-0">
                         <div id="sourceMasonryGrid" class="w-full columns-2 md:columns-4 lg:columns-5 gap-4 space-y-4"></div>
                         <div id="sourceLoadMoreTrigger" class="py-8 flex justify-center"><div class="loader"></div></div>
                     </div>
                </div>
            `;
            }

            if (window.sourceLibraryState.isLoading || !window.sourceLibraryState.hasMore) return;
            window.sourceLibraryState.isLoading = true;

            try {
                const res = await fetch(`/api/source?page=${window.sourceLibraryState.page}&limit=20`);
                const data = await res.json();
                const grid = document.getElementById('sourceMasonryGrid');
                const trigger = document.getElementById('sourceLoadMoreTrigger');

                if (data.images && data.images.length > 0) {
                    const html = data.images.map(img => `
                         <div class="group relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 break-inside-avoid shadow-sm hover:shadow-yellow-500/10 transition-all duration-300 transform hover:-translate-y-1">
                             <div class="absolute inset-0 flex items-center justify-center bg-zinc-900" id="src-skeleton-${img.id}">
                                 <i data-lucide="image" class="w-6 h-6 text-zinc-700 animate-pulse"></i>
                             </div>
                             <img src="${img.url}" onload="document.getElementById('src-skeleton-${img.id}')?.remove(); this.classList.remove('opacity-0')" class="w-full h-auto object-cover opacity-0 transition-opacity duration-500">
                             <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2">
                                  <button onclick="window.deleteSourceImage(${img.id})" class="p-2.5 bg-red-900/80 hover:bg-red-800 rounded-full text-white backdrop-blur-sm transition-colors transform hover:scale-110">
                                     <i data-lucide="trash-2" class="w-5 h-5"></i>
                                  </button>
                             </div>
                         </div>
                     `).join('');

                    if (grid) grid.insertAdjacentHTML('beforeend', html);

                    if (window.sourceLibraryState.page >= data.num_pages) {
                        window.sourceLibraryState.hasMore = false;
                        if (trigger) trigger.innerHTML = '<span class="text-zinc-600 text-xs">No more sources</span>';
                    } else {
                        window.sourceLibraryState.page++;
                        if (trigger) trigger.innerHTML = '<button onclick="window.loadMoreSource()" class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">Load More</button>';
                    }
                } else if (!append) {
                    const scrollArea = els.viewContainer.querySelector('.overflow-y-auto');
                    if (scrollArea) scrollArea.innerHTML = `
                    <div class="h-full flex flex-col items-center justify-center text-zinc-600 gap-4 mt-20">
                       <i data-lucide="hard-drive" class="w-12 h-12 opacity-50"></i>
                       <p>Library is empty.</p>
                    </div>
                 `;
                }

            } catch (e) {
                console.error(e);
                if (!append) els.viewContainer.innerHTML = `<p class="text-red-500 p-6">Error loading library</p>`;
            } finally {
                window.sourceLibraryState.isLoading = false;
                safeCreateIcons();
            }
        };

        window.loadMoreSource = () => {
            const trigger = document.getElementById('sourceLoadMoreTrigger');
            if (trigger) trigger.innerHTML = '<div class="loader"></div>';
            renderSourceLibraryView(true);
        };

        window.triggerSourceUpload = () => {
            document.getElementById('sourceUploadInput').click();
        };

        // Delegate change event for dynamic input
        document.addEventListener('change', async (e) => {
            if (e.target.id === 'sourceUploadInput' && e.target.files[0]) {
                const formData = new FormData();
                formData.append('image', e.target.files[0]);

                try {
                    const res = await fetch('/api/source/upload', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await res.json();
                    if (data.success) {
                        renderSourceLibraryView();
                    } else {
                        alert(data.error || 'Upload failed');
                    }
                } catch (err) {
                    console.error(err);
                    alert('Upload error');
                }
            }
        });

        window.deleteSourceImage = async (id) => {
            if (!confirm("Delete source image?")) return;
            try {
                await fetch(`/api/source/${id}/delete`, { method: 'DELETE' });
                renderSourceLibraryView();
            } catch (e) {
                alert('Delete failed');
            }
        };

        // --- Modal Logic ---
        let activeUploadTarget = null; // { key: 'identitySwap', subKey: 'face' } etc

        window.openSourceModal = (targetKey, targetSubKey = null) => {
            activeUploadTarget = { key: targetKey, subKey: targetSubKey };
            const modal = document.getElementById('sourceSelectModal');
            const grid = document.getElementById('sourceModalGrid');
            modal.classList.remove('hidden');

            // Load images into grid
            grid.innerHTML = '<div class="loader"></div>';
            fetch('/api/source')
                .then(r => r.json())
                .then(data => {
                    if (data.images && data.images.length > 0) {
                        grid.innerHTML = data.images.map(img => `
                         <div class="aspect-square bg-black border border-zinc-800 rounded cursor-pointer hover:border-yellow-500 overflow-hidden"
                              onclick="window.selectSourceImage('${img.url}')">
                             <img src="${img.url}" class="w-full h-full object-contain pointer-events-none">
                         </div>
                     `).join('');
                    } else {
                        grid.innerHTML = '<p class="col-span-full text-center text-zinc-500 text-xs py-4">No images in library</p>';
                    }
                });
        };

        document.getElementById('closeSourceModalBtn').addEventListener('click', () => {
            document.getElementById('sourceSelectModal').classList.add('hidden');
            activeUploadTarget = null;
        });

        document.getElementById('uploadLocalBtn').addEventListener('click', () => {
            document.getElementById('sourceSelectModal').classList.add('hidden');
            // Trigger the original hidden input corresponding to active target
            // We need to map activeUploadTarget to the DOM input ID
            let inputId = null;
            if (activeUploadTarget.key === 'referenceImage') inputId = 'referenceInput';
            else if (activeUploadTarget.key === 'composition') {
                inputId = activeUploadTarget.subKey === 'model' ? 'comp-model-upload' : 'comp-garment-upload';
            } else if (activeUploadTarget.key === 'identitySwap') {
                inputId = activeUploadTarget.subKey === 'scene' ? 'swap-scene-upload' : 'swap-face-upload';
            } else if (activeUploadTarget.key === 'generation') {
                if (activeUploadTarget.subKey === 'model1') inputId = 'gen-model1-upload';
                else if (activeUploadTarget.subKey === 'model2') inputId = 'gen-model2-upload';
                else if (activeUploadTarget.subKey === 'object1') inputId = 'gen-obj1-upload';
                else if (activeUploadTarget.subKey === 'object2') inputId = 'gen-obj2-upload';
                else if (activeUploadTarget.subKey === 'reference1') inputId = 'gen-ref1-upload';
                else if (activeUploadTarget.subKey === 'reference2') inputId = 'gen-ref2-upload';
            } else if (activeUploadTarget.key === 'promptGen') {
                if (activeUploadTarget.subKey === 'model1') inputId = 'pg-model1-upload';
                else if (activeUploadTarget.subKey === 'model2') inputId = 'pg-model2-upload';
                else if (activeUploadTarget.subKey === 'object1') inputId = 'pg-obj1-upload';
                else if (activeUploadTarget.subKey === 'object2') inputId = 'pg-obj2-upload';
                else if (activeUploadTarget.subKey === 'reference1') inputId = 'pg-ref1-upload';
                else if (activeUploadTarget.subKey === 'reference2') inputId = 'pg-ref2-upload';
            }

            if (inputId) {
                document.getElementById(inputId).click();
            }
        });

        window.selectSourceImage = (url) => {
            // Fetch blob and convert to base64
            fetch(url)
                .then(r => r.blob())
                .then(b => fileToBase64(b))
                .then(b64 => {
                    // Set state
                    if (activeUploadTarget.subKey) {
                        state[activeUploadTarget.key][activeUploadTarget.subKey] = b64;
                    } else {
                        state[activeUploadTarget.key] = b64; // referenceImage
                    }

                    // Close modal and update view
                    document.getElementById('sourceSelectModal').classList.add('hidden');
                    renderView();
                });
        };

        // Override listeners to open modal
        els.attachBtn.addEventListener('click', (e) => {
            e.stopImmediatePropagation(); // Prevent default if any
            openSourceModal('referenceImage');
        });

        // Proxy function to start masking by key
        window.startMaskingByKey = (key, subKey) => {
            // Handle stringified null/undefined from HTML template
            let effectiveSubKey = subKey;
            if (subKey === 'null' || subKey === 'undefined') effectiveSubKey = null;

            try {
                const image = effectiveSubKey ? state[key][effectiveSubKey] : state[key];
                if (image) {
                    // Set active target
                    activeMaskTarget = { key, subKey: effectiveSubKey };
                    window.openMaskEditor(image);
                } else {
                    console.error("Masking Error: Image not found for", key, effectiveSubKey);
                    alert("Could not load image for editing.");
                }
            } catch (e) {
                console.error("Masking Exception:", e);
                alert("Error opening mask editor: " + e.message);
            }
        };


        const createUploadBox = (id, label, iconName, imageStateKey, subKey, helpText) => {
            const image = subKey ? state[imageStateKey][subKey] : state[imageStateKey];
            const hasImage = !!image;

            // Determine if this box supports masking
            let canMask = state.config.showBrushTools;

            // Check if this specific box is the one masked
            const myListId = `${imageStateKey}-${subKey}`;
            const isMasked = canMask && state.maskImage && state.maskSource === myListId;

            return `
            <div class="flex-1 min-w-[200px] h-full flex flex-col gap-2">
               <span class="text-xs font-medium text-zinc-500 uppercase tracking-wider pl-1">${label}</span>
               <div id="${id}-wrapper"
                 class="relative flex-1 rounded-2xl border-2 border-dashed transition-all overflow-hidden group min-h-[200px] max-h-[60vh] flex flex-col ${hasImage ? 'border-zinc-800 bg-black' : 'border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50 hover:border-zinc-700 cursor-pointer'}"
                 onclick="openSourceModal('${imageStateKey}', '${subKey}')"
               >
                 <input type="file" id="${id}" class="hidden" accept="image/*">
                 
                 ${hasImage ? `
                     <img src="${image}" class="w-full h-full object-contain" />
                     
                     ${isMasked ? `
                        <!-- Red Mask Overlay -->
                        <div class="absolute inset-0 z-0 pointer-events-none" 
                             style="-webkit-mask-image: url(${state.maskImage}); mask-image: url(${state.maskImage}); -webkit-mask-size: contain; mask-size: contain; mask-position: center; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; background-color: rgba(255, 0, 0, 0.4);">
                        </div>
                     ` : ''}

                     <button  id="${id}-remove"
                        class="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors group-hover:opacity-100 opacity-0 z-10"
                        onclick="event.stopPropagation(); window.removeImage('${imageStateKey}', '${subKey}')"
                     >
                       <i data-lucide="x" class="w-4 h-4"></i>
                     </button>

                     ${canMask ? `
                         <button
                            class="absolute bottom-2 right-2 p-1.5 ${isMasked ? 'bg-yellow-500 text-black' : 'bg-black/50 text-white hover:bg-black/80'} rounded-full transition-colors group-hover:opacity-100 opacity-0 flex items-center gap-1 z-10"
                            onclick="event.stopPropagation(); window.startMaskingByKey('${imageStateKey}', '${subKey}')"
                            title="Mask / Edit"
                         >
                           <i data-lucide="${isMasked ? 'check' : 'brush'}" class="w-4 h-4"></i>
                         </button>
                         ${isMasked ? '<div class="absolute top-2 left-2 bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full z-10">MASKED</div>' : ''}
                     ` : ''}

                 ` : `
                   <div class="absolute inset-0 flex flex-col items-center justify-center text-zinc-600 gap-2 p-4 text-center pointer-events-none">
                     <div class="p-3 rounded-full bg-zinc-800/50">
                       <i data-lucide="${iconName}" class="w-6 h-6"></i>
                     </div>
                     <span class="text-sm font-medium">Click to Upload</span>
                     <span class="text-[10px] text-zinc-500 max-w-[80%]">${helpText}</span>
                   </div>
                 `}
               </div>
            </div>
        `;
        };

        // Global remove handler to avoid closure issues in HTML string
        window.removeImage = (key, subKey) => {
            if (subKey !== 'undefined' && subKey !== 'null') state[key][subKey] = null;
            else state[key] = null;

            // Also reset mask if we are removing the masked image
            // Simplest: Reset mask whenever any image is removed, or check specifics. 
            // For now: Reset global mask state to be safe.
            state.maskImage = null;
            state.maskSource = null;

            renderView();
        }

        // Attach listeners function is simpler now, just for the hidden input change
        const attachUploadListeners = (id, imageStateKey, subKey) => {
            const input = document.getElementById(id);
            if (input && !input.hasAttribute('data-has-listener')) {
                input.addEventListener('change', async (e) => {
                    if (e.target.files[0]) {
                        const b64 = await fileToBase64(e.target.files[0]);
                        if (subKey) state[imageStateKey][subKey] = b64;
                        else state[imageStateKey] = b64;
                        renderView();
                    }
                });
                input.setAttribute('data-has-listener', 'true');
            }
        };

        const updateUI = () => {
            // Mode buttons
            els.modeBtns.forEach(btn => {
                if (btn.dataset.mode === state.mode) {
                    btn.classList.add('bg-zinc-800', 'text-white', 'shadow-sm');
                    btn.classList.remove('text-zinc-500');
                } else {
                    btn.classList.remove('bg-zinc-800', 'text-white', 'shadow-sm');
                    btn.classList.add('text-zinc-500');
                }
            });

            // Attachment Area visibility
            if (state.mode === 'generation_legacy') {
                els.attachmentArea.classList.remove('hidden');
            } else {
                els.attachmentArea.classList.add('hidden');
            }

            const genSettings = document.getElementById('generationSettings');
            const pgSettings = document.getElementById('promptGenSettings');
            const genMediaSec = document.getElementById('generationMediaSection');
            const brushToolsSec = document.getElementById('brushToolsSection');
            const presetModeLabel = document.getElementById('presetModeLabel');

            if (state.mode === 'prompt_gen') {
                if (genSettings) genSettings.classList.add('hidden');
                if (genMediaSec) genMediaSec.classList.add('hidden');
                if (brushToolsSec) brushToolsSec.classList.add('hidden');
                if (pgSettings) pgSettings.classList.remove('hidden');
                if (presetModeLabel) { presetModeLabel.classList.remove('hidden'); presetModeLabel.textContent = 'Prompt Gen'; }
                els.generateBtn.innerHTML = '<span class="hidden md:inline">Prompt Generate</span><i data-lucide="wand-2" class="w-5 h-5"></i>';
                els.generateBtn.classList.add('bg-yellow-500', 'text-black');
                els.generateBtn.classList.remove('bg-zinc-800', 'text-white');
            } else if (state.mode === 'library' || state.mode === 'source_library' || state.mode === 'workflow_studio') {
                if (genSettings) genSettings.classList.add('hidden');
                if (pgSettings) pgSettings.classList.add('hidden');
                if (genMediaSec) genMediaSec.classList.add('hidden');
                if (brushToolsSec) brushToolsSec.classList.add('hidden');
                if (presetModeLabel) presetModeLabel.classList.add('hidden');
            } else {
                // Generation modes
                if (genSettings) genSettings.classList.remove('hidden');
                if (genMediaSec) genMediaSec.classList.remove('hidden');
                if (brushToolsSec) brushToolsSec.classList.remove('hidden');
                if (pgSettings) pgSettings.classList.add('hidden');
                if (presetModeLabel) { presetModeLabel.classList.remove('hidden'); presetModeLabel.textContent = 'Gen'; }
                els.generateBtn.innerHTML = '<span class="hidden md:inline">Generate</span><i data-lucide="sparkles" class="w-5 h-5"></i>';
                els.generateBtn.classList.remove('bg-yellow-500', 'text-black');
                els.generateBtn.classList.add('bg-zinc-800', 'text-white');
            }

            // Update Resolution Buttons
            els.resolutionBtns.forEach(btn => {
                if (btn.dataset.resolution === state.config.resolution) {
                    btn.classList.add('bg-zinc-700/50', 'text-white', 'border-zinc-600');
                    btn.classList.remove('hover:text-zinc-200', 'hover:bg-zinc-800', 'border-transparent', 'hover:border-zinc-700', 'text-zinc-400');
                    const textEl = document.getElementById('resolutionSelectedText');
                    if (textEl) textEl.textContent = state.config.resolution;
                } else {
                    btn.classList.remove('bg-zinc-700/50', 'text-white', 'border-zinc-600');
                    btn.classList.add('hover:text-zinc-200', 'hover:bg-zinc-800', 'border-transparent', 'hover:border-zinc-700', 'text-zinc-400');
                }
            });

            // Update Aspect Ratio Buttons
            els.aspectBtns.forEach(btn => {
                if (btn.dataset.ratio === state.config.aspectRatio) {
                    btn.classList.add('bg-zinc-700/50', 'text-white', 'border-zinc-600');
                    btn.classList.remove('hover:text-zinc-200', 'hover:bg-zinc-800', 'border-transparent', 'hover:border-zinc-700', 'text-zinc-400');
                    const textEl = document.getElementById('aspectRatioSelectedText');
                    if (textEl) textEl.textContent = state.config.aspectRatio;
                } else {
                    btn.classList.remove('bg-zinc-700/50', 'text-white', 'border-zinc-600');
                    btn.classList.add('hover:text-zinc-200', 'hover:bg-zinc-800', 'border-transparent', 'hover:border-zinc-700', 'text-zinc-400');
                }
            });

            // Sync Sidebar Input if available
            const pgSourceInput = document.getElementById('pgSourceInput');
            if (pgSourceInput) {
                pgSourceInput.value = state.prompt;
            }

            // Hide Prompt Bar in Library
            const promptBar = document.getElementById('bottomPromptBar');
            if (promptBar) {
                if (state.mode === 'library' || state.mode === 'source_library') promptBar.classList.add('hidden');
                else promptBar.classList.remove('hidden');
            }

            els.referencePreview.classList.add('hidden');
        };

        // Event Listeners - Init
        els.modeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.mode = btn.dataset.mode;
                state.currentImage = null;
                state.maskImage = null;
                state.maskSource = null;
                renderView();
                renderPresets();
            });
        });

        els.resolutionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.config.resolution = btn.dataset.resolution;
                document.getElementById('resolutionDropdown')?.classList.add('hidden');
                updateUI();
            });
        });

        els.aspectBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.config.aspectRatio = btn.dataset.ratio;
                document.getElementById('aspectRatioDropdown')?.classList.add('hidden');
                updateUI();
            });
        });

        if (els.pgTypeImageBtn && els.pgTypeVideoBtn) {
            els.pgTypeImageBtn.addEventListener('click', () => {
                state.promptGenAction = 'image';
                els.pgTypeImageBtn.classList.remove('text-zinc-500', 'hover:text-white');
                els.pgTypeImageBtn.classList.add('bg-zinc-700/50', 'text-white');
                els.pgTypeVideoBtn.classList.remove('bg-zinc-700/50', 'text-white');
                els.pgTypeVideoBtn.classList.add('text-zinc-500', 'hover:text-white');
            });
            els.pgTypeVideoBtn.addEventListener('click', () => {
                state.promptGenAction = 'video';
                els.pgTypeVideoBtn.classList.remove('text-zinc-500', 'hover:text-white');
                els.pgTypeVideoBtn.classList.add('bg-zinc-700/50', 'text-white');
                els.pgTypeImageBtn.classList.remove('bg-zinc-700/50', 'text-white');
                els.pgTypeImageBtn.classList.add('text-zinc-500', 'hover:text-white');
            });
        }

        if (els.addPgPresetBtn) {
            els.addPgPresetBtn.addEventListener('click', () => {
                openPgEditForm();
            });
        }

        if (els.cancelPgPresetEditBtn) {
            els.cancelPgPresetEditBtn.addEventListener('click', closePgEditForm);
        }
        if (els.savePgPresetBtn) {
            els.savePgPresetBtn.addEventListener('click', savePgEditForm);
        }

        // Dropdown toggle listeners
        const aspectTrigger = document.getElementById('aspectRatioTrigger');
        const aspectDropdown = document.getElementById('aspectRatioDropdown');
        const resTrigger = document.getElementById('resolutionTrigger');
        const resDropdown = document.getElementById('resolutionDropdown');

        if (aspectTrigger && aspectDropdown) {
            aspectTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                aspectDropdown.classList.toggle('hidden');
                if (resDropdown) resDropdown.classList.add('hidden'); // Close the other
            });
        }

        if (resTrigger && resDropdown) {
            resTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                resDropdown.classList.toggle('hidden');
                if (aspectDropdown) aspectDropdown.classList.add('hidden'); // Close the other
            });
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (aspectDropdown && !aspectDropdown.classList.contains('hidden') && !aspectTrigger.contains(e.target) && !aspectDropdown.contains(e.target)) {
                aspectDropdown.classList.add('hidden');
            }
            if (resDropdown && !resDropdown.classList.contains('hidden') && !resTrigger.contains(e.target) && !resDropdown.contains(e.target)) {
                resDropdown.classList.add('hidden');
            }
        });

        els.groundingToggle.addEventListener('change', (e) => {
            state.config.useGrounding = e.target.checked;
        });

        if (els.brushToggle) {
            els.brushToggle.addEventListener('change', (e) => {
                state.config.showBrushTools = e.target.checked;
                renderView();
            });
        }

        els.promptInput.addEventListener('input', (e) => {
            state.prompt = e.target.value;
            els.promptLength.textContent = state.prompt.length;
            const pgSourceInput = document.getElementById('pgSourceInput');
            if (pgSourceInput) pgSourceInput.value = state.prompt;
        });

        // Also listen to sidebar input to sync down
        const sideInput = document.getElementById('pgSourceInput');
        if (sideInput) {
            sideInput.addEventListener('input', (e) => {
                state.prompt = e.target.value;
                els.promptInput.value = state.prompt;
                els.promptLength.textContent = state.prompt.length;
            });
        }

        els.removeReferenceBtn.addEventListener('click', () => {
            state.referenceImage = null;
            renderView();
        });

        // --- Mask Editor Logic ---
        const maskEls = {
            modal: document.getElementById('maskEditorModal'),
            canvas: document.getElementById('maskCanvas'),
            ctx: document.getElementById('maskCanvas').getContext('2d'),
            targetImg: document.getElementById('maskTargetImage'),
            brushSize: document.getElementById('brushSize'),
            clearBtn: document.getElementById('clearMaskBtn'),
            saveBtn: document.getElementById('saveMaskBtn'),
            closeBtn: document.getElementById('closeMaskEditorBtn'),
            container: document.getElementById('maskCanvasContainer')
        };

        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;

        window.openMaskEditor = (imageSource) => {
            let src = imageSource;
            if (!src || typeof src !== 'string') {
                src = state.referenceImage;
            }
            if (!src) return;

            maskEls.modal.classList.remove('hidden');
            maskEls.targetImg.src = src;

            // Wait for image load
            maskEls.targetImg.onload = () => {
                maskEls.canvas.width = maskEls.targetImg.width;
                maskEls.canvas.height = maskEls.targetImg.height;
                maskEls.ctx.clearRect(0, 0, maskEls.canvas.width, maskEls.canvas.height);

                // Set canvas visual opacity to 0.5 to allow seeing through the red mask
                maskEls.canvas.style.opacity = '0.5';

                // If we have an existing mask for this source, load and colorize it
                let existingMask = null;
                if (activeMaskTarget) {
                    const id = `${activeMaskTarget.key}-${activeMaskTarget.subKey}`;
                    if (state.maskSource === id) existingMask = state.maskImage;
                } else if (state.mode === 'generation' && state.maskSource === 'referenceImage-null') {
                    existingMask = state.maskImage;
                }

                if (existingMask) {
                    const img = new Image();
                    img.onload = () => {
                        maskEls.ctx.drawImage(img, 0, 0);
                        // Convert White (Backend format) to Red (Display format)
                        const imageData = maskEls.ctx.getImageData(0, 0, maskEls.canvas.width, maskEls.canvas.height);
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i += 4) {
                            // If pixel has alpha, make it Solid Red (opacity handled by canvas CSS)
                            if (data[i + 3] > 0) {
                                data[i] = 255;   // R
                                data[i + 1] = 0;   // G
                                data[i + 2] = 0;   // B
                                data[i + 3] = 255; // Alpha 1.0 (Solid)
                            }
                        }
                        maskEls.ctx.putImageData(imageData, 0, 0);
                    };
                    img.src = existingMask;
                }
            };
        };

        window.closeMaskEditor = () => {
            maskEls.modal.classList.add('hidden');
            maskEls.canvas.style.opacity = '1'; // Reset
            activeMaskTarget = null; // Reset target on close? Or Keep? Better reset to avoid stale state.
        };

        // Drawing Events
        const getPos = (e) => {
            const rect = maskEls.canvas.getBoundingClientRect();
            const scaleX = maskEls.canvas.width / rect.width;
            const scaleY = maskEls.canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

        maskEls.canvas.addEventListener('mousedown', (e) => {
            isDrawing = true;
            const pos = getPos(e);
            lastX = pos.x;
            lastY = pos.y;
        });

        maskEls.canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing) return;
            const pos = getPos(e);

            maskEls.ctx.beginPath();
            maskEls.ctx.moveTo(lastX, lastY);
            maskEls.ctx.lineTo(pos.x, pos.y);
            // Solid Red brush (opacity handled by canvas style)
            maskEls.ctx.strokeStyle = '#ff0000';
            maskEls.ctx.lineCap = 'round';
            maskEls.ctx.lineJoin = 'round';
            maskEls.ctx.lineWidth = maskEls.brushSize.value;
            maskEls.ctx.stroke();

            lastX = pos.x;
            lastY = pos.y;
        });

        window.addEventListener('mouseup', () => isDrawing = false);

        // Toolbar Actions
        maskEls.clearBtn.addEventListener('click', () => {
            maskEls.ctx.clearRect(0, 0, maskEls.canvas.width, maskEls.canvas.height);
        });

        maskEls.saveBtn.addEventListener('click', () => {
            // Save RED mask (as drawn) because Backend was updated to expect Red
            state.maskImage = maskEls.canvas.toDataURL('image/png');

            if (activeMaskTarget) {
                state.maskSource = `${activeMaskTarget.key}-${activeMaskTarget.subKey}`;
            } else {
                // Fallback
                if (state.mode === 'generation') state.maskSource = 'referenceImage-null';
            }

            window.closeMaskEditor();
            renderView();
        });

        maskEls.closeBtn.addEventListener('click', window.closeMaskEditor);

        // Modify els.generateBtn listener to include maskImage
        els.generateBtn.addEventListener('click', async () => {
            if (state.mode === 'prompt_gen') {
                window.generateMjPrompt();
                return;
            }

            if (!state.prompt) {
                showError("Please enter a text prompt.");
                return;
            }
            let refImages = [];
            if (state.mode === 'generation') {
                // New Multi-Image Logic (Model, Object, Reference slots)
                if (state.generation.model1) refImages.push(state.generation.model1);
                if (state.generation.model2) refImages.push(state.generation.model2);
                if (state.generation.object1) refImages.push(state.generation.object1);
                if (state.generation.object2) refImages.push(state.generation.object2);
                if (state.generation.reference1) refImages.push(state.generation.reference1);
                if (state.generation.reference2) refImages.push(state.generation.reference2);
                // Legacy fallback
                if (state.referenceImage && refImages.length === 0) {
                    refImages.push(state.referenceImage);
                }
            } else if (state.mode === 'composition') {
                if (!state.composition.model || !state.composition.garment) {
                    showError("Please upload both model and garment images.");
                    return;
                }
                refImages.push(state.composition.model, state.composition.garment);
            } else if (state.mode === 'identity_swap') {
                if (!state.identitySwap.scene || !state.identitySwap.face) {
                    showError("Please upload both scene and face images.");
                    return;
                }
                refImages.push(state.identitySwap.scene, state.identitySwap.face);
            }

            setGenerating(true);

            try {
                const payload = {
                    prompt: state.prompt,
                    config: state.config,
                    referenceImages: refImages
                };

                // Add mask if it exists (Generic)
                if (state.maskImage) {
                    payload.maskImage = state.maskImage;
                }

                const response = await fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (!response.ok) {
                    console.error("Server Error:", data);
                    throw new Error(data.error || `Server returned ${response.status}`);
                }

                if (data.error) {
                    showError(data.error);
                } else {
                    state.currentImage = data.url;
                    renderView();
                }
            } catch (e) {
                console.error("Fetch Error:", e);
                showError(e.message || "Network error occurred.");
            } finally {
                setGenerating(false);
            }
        });

        // Preset Event Listeners
        els.addPresetBtn.addEventListener('click', () => openEditForm());
        els.cancelPresetEditBtn.addEventListener('click', closeEditForm);
        els.savePresetBtn.addEventListener('click', saveEditForm);

        // Initial Render
        loadPresets();
        renderView();
        renderPresets();
        // Simulate click on 1:1 aspect ratio to set initial state UI
        document.querySelector('[data-ratio="1:1"]').click();
    });
