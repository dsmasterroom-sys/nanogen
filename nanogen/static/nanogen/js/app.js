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
        presets: [],
        isEditingPreset: false,
        // New: Generation Mode multi-image state
        generation: {
            image1: null,
            image2: null
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
        presetsList: document.getElementById('presetsList')
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

    // --- Prompt Gen Logic ---
    // 5-Step Structure according to Expert Guide
    // --- Prompt Gen Logic ---
    // 5-Step Structure according to Expert Guide
    let MIDJOURNEY_PRESETS = {
        styles: [], global_details: [], expression: [], camera_angle: [],
        characteristics: [], pose: [], action: [], lighting: [],
        atmosphere: [], character_details: [], env_details: []
    };

    const loadMjPresets = async () => {
        try {
            const res = await fetch('/api/prompt/presets');
            const data = await res.json();
            if (data && !data.error) {
                MIDJOURNEY_PRESETS = data;
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

        // Helper for Multi-Select Chips with Edit Controls
        const renderChips = (category, items) => `
            <div class="flex flex-wrap gap-2" id="pg_${category}">
                ${items.map(item => `
                    <div class="relative group inline-flex">
                        <button onclick="window.toggleMjOption('${category}', '${item.label}')"
                            class="px-3 py-1.5 rounded-full text-xs font-medium border transition-all 
                            ${window.promptGenState[category].includes(item.label)
                ? 'bg-yellow-900/50 border-yellow-500 text-yellow-200'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}">
                            ${item.label}
                        </button>
                        ${window.isEditingPrompt ? `
                            <button onclick="window.deleteMjOption('${item.db_id}')" class="absolute -top-1 -right-1 bg-red-600 text-white rounded-full p-0.5 w-4 h-4 flex items-center justify-center hover:scale-110 shadow-sm z-10" title="Delete">
                                &times;
                            </button>
                        ` : ''}
                    </div>
                `).join('')}
                ${window.isEditingPrompt ? `
                    <button onclick="window.addMjOption('${category}')" class="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-zinc-600 text-zinc-500 hover:text-white hover:border-zinc-400 transition-all flex items-center gap-1">
                        <i data-lucide="plus" class="w-3 h-3"></i> Add
                    </button>
                ` : ''}
            </div>`;

        // Helper for Select with Edit Controls
        const renderSelectOrChips = (id, category, options) => {
            if (window.isEditingPrompt) {
                return renderChips(category, options);
            }
            return `
            <select onchange="window.promptGenState['${category}'] = this.value" 
                class="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg p-2.5 focus:border-yellow-500">
                <option value="">None</option>
                ${options.map(o => `<option value="${o.label}" ${window.promptGenState[category] === o.label ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>`;
        };

        const renderSelect = renderSelectOrChips; // Override

        // Preserve scroll position
        const scrollContainer = els.viewContainer.querySelector('.overflow-y-auto');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

        els.viewContainer.innerHTML = `
            <div class="w-full h-full p-6 overflow-y-auto custom-scrollbar flex flex-col items-center">
                <div class="w-full max-w-4xl flex flex-col gap-8 pb-20">
                    
                    <div class="flex items-center justify-between mb-2">
                        <h2 class="text-xl font-bold text-white flex items-center gap-2">
                            <i data-lucide="sparkles" class="w-6 h-6 text-yellow-500"></i> Midjourney Prompt Generator
                        </h2>
                        <div class="flex items-center gap-2">
                            <button id="pgResetBtn"
                                class="hidden px-3 py-1.5 bg-red-900/50 hover:bg-red-800 border border-red-700 rounded-lg text-xs font-medium text-red-200 flex items-center gap-2 transition-all">
                                <i data-lucide="rotate-ccw" class="w-3 h-3"></i> Reset to Defaults
                            </button>
                            <button id="pgEditModeBtn"
                                class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs font-medium text-zinc-400 flex items-center gap-2 transition-all">
                                <i data-lucide="edit-3" class="w-3 h-3"></i> Edit Mode
                            </button>
                        </div>
                    </div>

                    <!-- STEP 0: Default (Species & Gender) -->
                    <div class="border border-zinc-800 bg-zinc-900/30 rounded-lg p-4 flex flex-col gap-4">
                         <h3 class="text-sm font-bold text-yellow-500 uppercase">Step 0: Default</h3>
                         <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <span class="text-xs text-zinc-400 mb-1 block">Species</span>
                                <select onchange="window.toggleSpecies(this.value)" class="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg p-2.5 focus:border-yellow-500">
                                    <option value="Human" ${window.promptGenState.species === 'Human' ? 'selected' : ''}>Human</option>
                                    <option value="Animal" ${window.promptGenState.species === 'Animal' ? 'selected' : ''}>Animal</option>
                                </select>
                                ${window.promptGenState.species === 'Animal' ? `
                                    <input type="text" placeholder="Enter animal type (e.g. Cat, Dragon)" 
                                        value="${window.promptGenState.animalType || ''}"
                                        oninput="window.promptGenState.animalType = this.value"
                                        class="mt-2 w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg p-2.5 focus:border-yellow-500 animate-fade-in">
                                ` : ''}
                            </div>
                            <div>
                                <span class="text-xs text-zinc-400 mb-1 block">Gender</span>
                                <select onchange="window.promptGenState.gender = this.value" class="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg p-2.5 focus:border-yellow-500">
                                    <option value="Female" ${window.promptGenState.gender === 'Female' ? 'selected' : ''}>Female</option>
                                    <option value="Male" ${window.promptGenState.gender === 'Male' ? 'selected' : ''}>Male</option>
                                    <option value="Genderless" ${window.promptGenState.gender === 'Genderless' ? 'selected' : ''}>Genderless</option>
                                </select>
                            </div>
                         </div>
                    </div>

                    <!-- Main Subject -->
                    <div class="flex flex-col gap-2">
                         <label class="text-sm font-semibold text-zinc-300">Description (Optional Context)</label>
                         <textarea id="pgSubject" rows="2" placeholder="e.g., A Korean woman in a cafe..."
                             class="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm text-white focus:border-yellow-500 resize-none">${window.promptGenState.subject}</textarea>
                    </div>

                    <!-- STEP 1 -->
                    <div class="border border-zinc-800 bg-zinc-900/30 rounded-lg p-4 flex flex-col gap-4">
                        <h3 class="text-sm font-bold text-yellow-500 uppercase">Step 1: Style & Details</h3>
                        <div>
                            <span class="text-xs text-zinc-400 mb-2 block">Style / Look</span>
                            ${renderChips('styles', MIDJOURNEY_PRESETS.styles)}
                        </div>
                        <div>
                            <span class="text-xs text-zinc-400 mb-2 block">Global Details</span>
                            ${renderChips('global_details', MIDJOURNEY_PRESETS.global_details)}
                        </div>
                    </div>

                    <!-- STEP 2 -->
                    <div class="border border-zinc-800 bg-zinc-900/30 rounded-lg p-4 flex flex-col gap-4">
                        <h3 class="text-sm font-bold text-yellow-500 uppercase">Step 2: Character & Camera</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <span class="text-xs text-zinc-400 mb-1 block">Expression & Attitude</span>
                                ${renderSelect('pgExpression', 'expression', MIDJOURNEY_PRESETS.expression)}
                            </div>
                            <div>
                                <span class="text-xs text-zinc-400 mb-1 block">Camera Angle</span>
                                ${renderSelect('pgAngle', 'camera_angle', MIDJOURNEY_PRESETS.camera_angle)}
                            </div>
                        </div>

                    <!-- STEP 3 -->
                    <div class="border border-zinc-800 bg-zinc-900/30 rounded-lg p-4 flex flex-col gap-4">
                        <h3 class="text-sm font-bold text-yellow-500 uppercase">Step 3: Pose & Action</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <span class="text-xs text-zinc-400 mb-1 block">Pose</span>
                                ${renderSelect('pgPose', 'pose', MIDJOURNEY_PRESETS.pose)}
                            </div>
                            <div>
                                <span class="text-xs text-zinc-400 mb-1 block">Action</span>
                                <input type="text" placeholder="Custom action... (e.g. drinking tea)" 
                                    onchange="window.promptGenState.action = this.value" value="${window.promptGenState.action}"
                                    class="w-full bg-zinc-900 border border-zinc-700 text-white text-sm rounded-lg p-2.5">
                            </div>
                        </div>
                    </div>

                    <!-- STEP 4 -->
                    <div class="border border-zinc-800 bg-zinc-900/30 rounded-lg p-4 flex flex-col gap-4">
                        <h3 class="text-sm font-bold text-yellow-500 uppercase">Step 4: Lighting & Atmosphere</h3>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <span class="text-xs text-zinc-400 mb-1 block">Lighting</span>
                                ${renderSelect('pgLighting', 'lighting', MIDJOURNEY_PRESETS.lighting)}
                            </div>
                        </div>
                        <div>
                            <span class="text-xs text-zinc-400 mb-2 block">Atmosphere / Mood</span>
                            ${renderChips('atmosphere', MIDJOURNEY_PRESETS.atmosphere)}
                        </div>
                    </div>

                    <!-- STEP 5 -->
                     <div class="border border-zinc-800 bg-zinc-900/30 rounded-lg p-4 flex flex-col gap-4">
                        <h3 class="text-sm font-bold text-yellow-500 uppercase">Step 5: Specific Details</h3>
                         <div>
                            <span class="text-xs text-zinc-400 mb-2 block">Character Details</span>
                            ${renderChips('character_details', MIDJOURNEY_PRESETS.character_details)}
                        </div>
                        <div>
                            <span class="text-xs text-zinc-400 mb-2 block">Environmental / Clothing Details</span>
                            ${renderChips('env_details', MIDJOURNEY_PRESETS.env_details)}
                        </div>
                    </div>

                    <!-- Action -->
                    <button onclick="window.generateMjPrompt()" class="mt-4 w-full py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all transform hover:scale-[1.01]">
                        <i data-lucide="wand-2" class="w-6 h-6"></i> Generate Prompt
                    </button>

                    <!-- Result -->
                    <div class="flex flex-col gap-2 mt-4 relative pb-10">
                        <label class="text-sm font-semibold text-zinc-300">Final Prompt</label>
                        <div class="relative">
                            <textarea id="pgResult" rows="6" readonly
                                class="w-full bg-black border border-zinc-700 rounded-lg p-4 text-sm text-yellow-500 font-mono resize-none"></textarea>
                             <button onclick="window.copyMjPrompt()" class="absolute top-2 right-2 p-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-md" title="Copy">
                                <i data-lucide="copy" class="w-4 h-4"></i>
                             </button>
                        </div>
                    </div>

                </div>
            </div>
        `;

        const btn = document.getElementById('pgEditModeBtn');


        if (btn) {
            btn.innerHTML = window.isEditingPrompt
                ? '<i data-lucide="check" class="w-3 h-3"></i> Done'
                : '<i data-lucide="edit-3" class="w-3 h-3"></i> Edit Mode';

            btn.onclick = () => {
                window.isEditingPrompt = !window.isEditingPrompt;
                renderPromptGenView();
            };
        }

        const resetBtn = document.getElementById('pgResetBtn');
        if (resetBtn) {
            if (window.isEditingPrompt) {
                resetBtn.classList.remove('hidden');
                resetBtn.onclick = async () => {
                    if (confirm('Are you sure you want to reset all options to default? This cannot be undone.')) {
                        try {
                            const res = await fetch('/api/prompt/option/reset', { method: 'POST' });
                            const d = await res.json();
                            if (d.success) {
                                await loadMjPresets();
                            } else {
                                alert('Reset failed: ' + d.error);
                            }
                        } catch (e) {
                            alert('Reset failed: ' + e);
                        }
                    }
                };
            } else {
                resetBtn.classList.add('hidden');
            }
        }

        // Bind subject input
        const subjBox = document.getElementById('pgSubject');
        if (subjBox) {
            subjBox.addEventListener('input', (e) => {
                window.promptGenState.subject = e.target.value;
            });
        }

        // Restore scroll position
        const newScrollContainer = els.viewContainer.querySelector('.overflow-y-auto');
        if (newScrollContainer && scrollTop > 0) {
            newScrollContainer.scrollTop = scrollTop;
        }

        safeCreateIcons();
    };

    window.generateMjPrompt = async () => {
        const btn = document.querySelector('button[onclick="window.generateMjPrompt()"]');
        const resBox = document.getElementById('pgResult');

        if (!window.promptGenState.subject) {
            alert('Please enter a subject.');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<div class="loader"></div> Processing...';
        }
        if (resBox) resBox.value = '';

        try {
            const response = await fetch('/api/prompt/midjourney', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...window.promptGenState,
                    config: state.config // Pass global config (resolution, AR)
                })
            });
            const data = await response.json();

            if (resBox) {
                if (data.prompt) {
                    resBox.value = data.prompt;
                } else {
                    resBox.value = "Error: " + (data.error || 'Unknown error');
                }
            }
        } catch (e) {
            if (resBox) resBox.value = "Network Error: " + e.message;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="wand-2" class="w-5 h-5"></i> Generate High-Quality Prompt';
            }
            safeCreateIcons();
        }
    };

    window.copyMjPrompt = () => {
        const text = document.getElementById('pgResult');
        text.select();
        document.execCommand('copy');
        alert('Copied to clipboard!');
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
    const renderGenerationView = () => {
        // If we have a result, show it? Or show side-by-side?
        // Current logic for other modes: show result heavily.
        // But user wants upload boxes.
        // Let's split screen if result exists, or full upload if not.

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

                <!-- Upload Area (Reference Images) -->
                <div class="${showResult ? 'h-1/3 min-h-[200px]' : 'flex-1'} p-6 flex flex-col md:flex-row gap-6 w-full max-w-6xl mx-auto">
                    <div class="flex-1 flex flex-col md:flex-row gap-6 h-full">
                        <!-- Image 1 -->
                         ${createUploadBox('gen-img1-upload', 'Reference Image 1', 'image', 'generation', 'image1', 'Upload main reference or base image')}
                        
                        <!-- Image 2 -->
                         ${createUploadBox('gen-img2-upload', 'Reference Image 2', 'layers', 'generation', 'image2', 'Upload secondary reference or style image')}
                    </div>
                </div>
            </div>
        `;

        attachUploadListeners('gen-img1-upload', 'generation', 'image1');
        attachUploadListeners('gen-img2-upload', 'generation', 'image2');
    };

    const renderLibraryView = async () => {
        els.viewContainer.innerHTML = '<div class="loader"></div>';
        try {
            const res = await fetch('/api/images');
            const data = await res.json();

            if (data.images && data.images.length > 0) {
                els.viewContainer.innerHTML = `
                    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-6 w-full h-full overflow-y-auto custom-scrollbar content-start">
                        ${data.images.map(img => {
                    // Safe prompt escaping
                    const safePrompt = img.prompt ? img.prompt.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ') : '';
                    return `
                            <div class="relative group rounded-xl overflow-hidden aspect-square border border-zinc-800 bg-zinc-900 cursor-pointer" onclick="window.openImageModal('${img.url}', '${safePrompt}')">
                                <img src="${img.url}" class="w-full h-full object-contain bg-black">
                                
                                <!-- Hover Overlay for Actions -->
                                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"></div>

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
                        `}).join('')}
                    </div>
                 `;
            } else {
                els.viewContainer.innerHTML = `
                    <div class="w-full h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
                        <i data-lucide="image" class="w-12 h-12 opacity-20"></i>
                        <p>No images generated yet.</p>
                    </div>
                 `;
            }
        } catch (e) {
            els.viewContainer.innerHTML = `<div class="text-red-500">Failed to load library: ${e.message}</div>`;
        }
        safeCreateIcons();
    };

    window.openImageModal = (url, prompt) => {
        // Simple modal implementation
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4'; // Removed animate-fade-in, increased opacity
        modal.onclick = () => modal.remove();
        modal.innerHTML = `
            <div class="relative max-w-7xl max-h-screen w-full h-full flex flex-col items-center justify-center" onclick="event.stopPropagation()">
                <img src="${url}" class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl border border-zinc-800">
                <div class="absolute top-4 right-4">
                     <button onclick="this.closest('.fixed').remove()" class="p-2 bg-black/50 hover:bg-black text-white rounded-full">
                        <i data-lucide="x" class="w-6 h-6"></i>
                    </button>
                </div>
                <div class="mt-4 bg-zinc-900/80 backdrop-blur px-6 py-3 rounded-xl border border-zinc-800 text-center max-w-2xl">
                    <p class="text-sm text-zinc-300 max-h-32 overflow-y-auto custom-scrollbar">${prompt}</p>
                </div>
            </div>
        `;
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

    const renderSourceLibraryView = async () => {
        els.viewContainer.innerHTML = '<div class="loader"></div>';
        try {
            const res = await fetch('/api/source');
            const data = await res.json();

            let html = `
            <div class="w-full h-full flex flex-col p-6 max-w-6xl">
                     <div class="flex justify-between items-center mb-6">
                        <h2 class="text-xl font-bold text-white flex items-center gap-2">
                             <i data-lucide="folder-open" class="w-5 h-5 text-yellow-500"></i> Source Library
                        </h2>
                        <button onclick="window.triggerSourceUpload()" class="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-lg flex items-center gap-2">
                            <i data-lucide="upload" class="w-4 h-4"></i> Upload New Image
                        </button>
                        <input type="file" id="sourceUploadInput" class="hidden" accept="image/*">
                     </div>

                     <div class="flex-1 overflow-y-auto custom-scrollbar">
            `;

            if (data.images && data.images.length > 0) {
                html += `<div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                     ${data.images.map(img => `
                         <div class="group relative rounded-lg overflow-hidden border border-zinc-800 bg-black aspect-square">
                             <img src="${img.url}" class="w-full h-full object-contain">
                             <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <button onclick="window.deleteSourceImage(${img.id})" class="p-2 bg-red-900/80 hover:bg-red-900 rounded-full text-white">
                                     <i data-lucide="trash-2" class="w-4 h-4"></i>
                                  </button>
                             </div>
                         </div>
                     `).join('')}
                 </div>`;
            } else {
                html += `
                    <div class="h-64 flex flex-col items-center justify-center text-zinc-600 gap-4">
                       <i data-lucide="hard-drive" class="w-12 h-12 opacity-50"></i>
                       <p>Library is empty.</p>
                    </div>
                 `;
            }

            html += `</div></div>`;
            els.viewContainer.innerHTML = html;
            safeCreateIcons();

        } catch (e) {
            console.error(e);
            els.viewContainer.innerHTML = `<p class="text-red-500">Error loading library</p>`;
        }
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
            inputId = activeUploadTarget.subKey === 'image1' ? 'gen-img1-upload' : 'gen-img2-upload';
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
        // Legacy: Hidden for now in favor of Central UI for Generation
        if (state.mode === 'generation_legacy') { // Renamed to disable
            els.attachmentArea.classList.remove('hidden');
        } else {
            els.attachmentArea.classList.add('hidden');
        }

        // Update Resolution Buttons
        els.resolutionBtns.forEach(btn => {
            if (btn.dataset.resolution === state.config.resolution) {
                btn.classList.add('border-yellow-500', 'text-yellow-500', 'bg-yellow-500/10');
                btn.classList.remove('border-zinc-800', 'text-zinc-500', 'bg-zinc-900');
            } else {
                btn.classList.remove('border-yellow-500', 'text-yellow-500', 'bg-yellow-500/10');
                btn.classList.add('border-zinc-800', 'text-zinc-500', 'bg-zinc-900');
            }
        });

        // Hide Prompt Bar in Library
        const promptBar = document.querySelector('.p-4.md\\:p-6.bg-zinc-900\\/80');
        if (promptBar) {
            if (state.mode === 'library' || state.mode === 'source_library' || state.mode === 'prompt_gen') promptBar.classList.add('hidden');
            else promptBar.classList.remove('hidden');
        }

        // Reference Preview
        // Legacy: Hidden for Generation (Central UI used instead)
        els.referencePreview.classList.add('hidden');
    };

    // Event Listeners - Init
    els.modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            state.mode = btn.dataset.mode;
            state.currentImage = null;
            // Clear mask on mode switch to prevent cross-contamination
            state.maskImage = null;
            state.maskSource = null;
            renderView();
            renderPresets();
        });
    });

    els.resolutionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            state.config.resolution = btn.dataset.resolution;
            updateUI();
        });
    });

    els.aspectBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            state.config.aspectRatio = btn.dataset.ratio;
            els.aspectBtns.forEach(b => {
                const dot = b.querySelector('div');
                if (b.dataset.ratio === state.config.aspectRatio) {
                    b.classList.add('border-yellow-500/50', 'bg-yellow-500/10');
                    b.classList.remove('border-zinc-800');
                    dot.classList.add('border-yellow-500');
                    dot.classList.remove('border-zinc-700');
                } else {
                    b.classList.remove('border-yellow-500/50', 'bg-yellow-500/10');
                    b.classList.add('border-zinc-800');
                    dot.classList.remove('border-yellow-500');
                    dot.classList.add('border-zinc-700');
                }
            });
        });
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
    });

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
        if (!state.prompt) {
            showError("Please enter a text prompt.");
            return;
        }
        let refImages = [];
        if (state.mode === 'generation') {
            // New Multi-Image Logic
            if (state.generation.image1) refImages.push(state.generation.image1);
            if (state.generation.image2) refImages.push(state.generation.image2);
            // Legacy fallback (should ideally be removed, but kept for safety if state.referenceImage is somehow set)
            if (state.referenceImage && !state.generation.image1 && !state.generation.image2) {
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
