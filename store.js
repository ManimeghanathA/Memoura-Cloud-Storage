// store.js (REVISED for Core Logic Preservation - V105)
const API_BASE_URL = "https://lj6mh0lwni.execute-api.us-east-1.amazonaws.com";

// Declare variables globally
let currentMode = 'HYBRID';
let modeTextGroup;
let modeFileGroup;
let statusMessage;
let isKeyAvailable = false;
let formatTimer = null;

// Cache state variables - CRITICAL FOR AI FORMATTING FLOW
let cacheState = {
    rawKey: null,
    formattedKey: null,
    sourceToCommit: 'raw',
    timerEndTime: null
};

const PREVIEW_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// Helper function to update mode button appearance (RETAINED)
window.updateModeButtonStyles = function() {
    const buttons = [
        { id: 'mode-text', mode: 'TEXT' },
        { id: 'mode-file', mode: 'FILE' },
        { id: 'mode-hybrid', mode: 'HYBRID' }
    ];

    buttons.forEach(item => {
        const button = document.getElementById(item.id);
        if (!button) return;
        const isActive = item.mode === currentMode;

        // Reset classes
        button.classList.remove(
            'bg-black', 'text-white', 'border-black', 'hover:bg-gray-800',
            'bg-white', 'text-black', 'border-gray-200', 'hover:bg-gray-100',
            'dark:bg-white', 'dark:text-black', 'dark:border-white', 'dark:hover:bg-gray-200',
            'dark:bg-black', 'dark:text-white', 'dark:border-gray-700', 'dark:hover:bg-gray-900'
        );

        if (isActive) {
            button.classList.add('bg-black', 'text-white', 'border-black', 'hover:bg-gray-800');
            button.classList.add('dark:bg-white', 'dark:text-black', 'dark:border-white', 'dark:hover:bg-gray-200');
        } else {
            button.classList.add('bg-white', 'text-black', 'border-gray-200', 'hover:bg-gray-100');
            button.classList.add('dark:bg-black', 'dark:text-white', 'dark:border-gray-700', 'dark:hover:bg-gray-900');
        }
    });
};

function lockForm(shouldLock) {
    const storeSection = document.getElementById('store-section');
    if (storeSection) {
        if (shouldLock) {
            storeSection.classList.add('locked');
        } else {
            storeSection.classList.remove('locked');
        }
    }
}

// Function to toggle password visibility (RETAINED)
window.togglePasswordVisibility = function(id) {
    const input = document.getElementById(id);
    const button = input.nextElementSibling;
    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = 'Hide';
    } else {
        input.type = 'password';
        button.textContent = 'Show';
    }
}

// Function to copy text from any element (RETAINED)
window.copyElementContent = function(elementId) {
    const element = document.getElementById(elementId);
    let textToCopy;

    if (element.tagName === 'A') {
        textToCopy = element.href;
    } else {
        textToCopy = element.textContent;
    }

    const tempInput = document.createElement('textarea');
    tempInput.value = textToCopy;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);

    const button = document.querySelector(`button[data-copy-target="${elementId}"]`);
    if (!button) return;

    const originalText = button.textContent;
    button.textContent = 'Copied!';

    // Theme-aware success flash
    button.classList.remove('bg-black', 'dark:bg-white', 'text-white', 'dark:text-black', 'hover:bg-gray-800', 'dark:hover:bg-gray-200');
    button.classList.add('bg-green-600', 'text-white');

    setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('bg-green-600', 'text-white');

        // Restore black/white theme for modal copy buttons
        button.classList.add('bg-white', 'text-black', 'hover:bg-gray-200');
    }, 1500);
};

document.addEventListener('DOMContentLoaded', function() {
    // Assign references
    modeTextGroup = document.getElementById('text-group');
    modeFileGroup = document.getElementById('file-group');
    statusMessage = document.getElementById('status-message');

    // Initialize mode and button styles
    setMode(currentMode);

    // Attach event listeners
    document.getElementById('store-form').addEventListener('submit', handleStoreSubmit);
    document.getElementById('custom-key').addEventListener('input', checkKeyAvailability);
    document.getElementById('custom-key').addEventListener('change', checkKeyAvailability);
    document.getElementById('format-button').addEventListener('click', handleFormatRequest);
    document.getElementById('content').addEventListener('input', toggleFormatButton);

    checkKeyAvailability();

    document.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-copy-target');
            copyElementContent(targetId);
        });
    });
});

// The setMode function (RETAINED)
window.setMode = function(mode) {
    currentMode = mode;

    const currentModeElement = document.getElementById('current-mode');
    if (currentModeElement) {
        currentModeElement.textContent = mode;
    }

    if (modeTextGroup && modeFileGroup) {
        modeTextGroup.style.display = (mode === 'TEXT' || mode === 'HYBRID') ? 'block' : 'none';
        modeFileGroup.style.display = (mode === 'FILE' || mode === 'HYBRID') ? 'block' : 'none';
    }

    toggleFormatButton();
    updateModeButtonStyles();
};

// Function to check key availability (RETAINED)
async function checkKeyAvailability() {
    const keyInput = document.getElementById('custom-key');
    const key = keyInput.value.trim().toUpperCase();
    statusMessage.textContent = '';

    keyInput.classList.remove('border-orange-500', 'border-red-500', 'border-green-500', 'border-2');
    keyInput.classList.add('border-gray-300');

    if (key.length === 0) {
        statusMessage.textContent = 'Please enter a unique Custom Key to unlock storage options.';
        keyInput.classList.add('border-orange-500', 'border-2');
        isKeyAvailable = false;
        lockForm(true);
        return;
    }

    statusMessage.textContent = `Checking key "${key}"...`;

    try {
        let response = await fetch(`${API_BASE_URL}/checkkey/${key}`, { method: 'GET' });

        if (response.status === 409) {
            statusMessage.textContent = `Error: Key "${key}" is already taken. Please choose another.`;
            keyInput.classList.add('border-red-500', 'border-2');
            isKeyAvailable = false;
            lockForm(true);
        } else if (response.ok) {
            statusMessage.textContent = `Success: Key "${key}" is available! Start typing your content.`;
            keyInput.classList.add('border-green-500', 'border-2');
            isKeyAvailable = true;
            lockForm(false);
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Unknown key check error.');
        }
    } catch (error) {
        console.error("Key Check Error:", error);
        statusMessage.textContent = `Key Check Error: ${error.message}`;
        keyInput.classList.add('border-orange-500', 'border-2');
        isKeyAvailable = false;
        lockForm(true);
    }

    toggleFormatButton();
}

// Function to toggle format button visibility (RETAINED)
function toggleFormatButton() {
    const content = document.getElementById('content').value.trim();
    const formatControls = document.getElementById('format-controls');

    if ((currentMode === 'TEXT' || currentMode === 'HYBRID') && content.length > 0 && isKeyAvailable) {
        formatControls.classList.remove('hidden');
    } else {
        formatControls.classList.add('hidden');
    }
}

// Function to handle the AI formatting request (Loading Spinner implemented)
async function handleFormatRequest() {
    const customKey = document.getElementById('custom-key').value.trim();
    const content = document.getElementById('content').value;
    const formatStatus = document.getElementById('format-status');
    const formatButton = document.getElementById('format-button');
    const previewSection = document.getElementById('preview-section');

    if (!customKey || !isKeyAvailable) {
        formatStatus.textContent = "Error: Please enter a valid and available key first.";
        return;
    }

    // UI: Show Loading Animation
    formatStatus.textContent = "";
    formatButton.disabled = true;
    formatButton.innerHTML = `
        <span class="flex items-center justify-center">
            <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Formatting...
        </span>
    `;

    try {
        let response = await fetch(`${API_BASE_URL}/format-preview/${customKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: content })
        });

        let data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'AI formatting failed.');
        }

        // IMPORTANT: Update cacheState correctly
        cacheState.rawKey = data.cache_raw_key;
        cacheState.formattedKey = data.cache_formatted_key;
        cacheState.rawPreviewUrl = data.raw_preview_url;
        cacheState.formattedPreviewUrl = data.formatted_preview_url;

        previewSection.classList.remove('hidden');

        const finalSelectionDiv = document.getElementById('final-source-selection');
        if (finalSelectionDiv) {
            finalSelectionDiv.classList.remove('hidden');
        }

        startPreviewTimer();

        window.showPreviewContent('formatted');
        formatStatus.textContent = 'Formatting complete! Review and click Store Securely to commit.';
    } catch (error) {
        console.error("Format Preview Error:", error);
        formatStatus.textContent = `Error during formatting: ${error.message}`;
    } finally {
        // Revert button state
        formatButton.disabled = false;
        formatButton.innerHTML = 'Format with AI';
    }
}

// 1. STORE HANDLER - CRITICAL LOGIC CHECK
async function handleStoreSubmit(e) {
    e.preventDefault();
    statusMessage.textContent = 'Processing request...';

    const customKey = document.getElementById('custom-key').value.trim();

    if (!customKey || !isKeyAvailable) {
        statusMessage.textContent = 'Error: Cannot store. Please fix the Custom Key conflict or enter a key.';
        return;
    }

    const content = document.getElementById('content').value;
    const fileInput = document.getElementById('file-input');
    const files = Array.from(fileInput.files);
    const password = document.getElementById('password').value;
    const lifetimeDays = parseFloat(document.getElementById('lifetime_days').value);
    const accessMode = document.getElementById('one_time_access').checked ? 'ONE_TIME' : 'OPEN';

    let chosenCacheKey = null;
    let requestBody = {
        custom_key: customKey,
        upload_mode: currentMode,
        lifetime_days: lifetimeDays,
        access_mode: accessMode
    };

    if (password) requestBody.password = password;

    if (currentMode === 'TEXT' || currentMode === 'HYBRID') {
        // *** ORIGINAL LOGIC RESTORED & CONFIRMED: Checks if formatting was used. ***
        if (cacheState.formattedKey && cacheState.rawKey) {
            // Use the selected key from the radio button group
            const finalSource = document.querySelector('input[name="final_source"]:checked');
            chosenCacheKey = finalSource.value === 'formatted' ? cacheState.formattedKey : cacheState.rawKey;

            // Pass the chosen S3 key and the two cache keys to the backend
            requestBody.s3_source_key = chosenCacheKey;
            requestBody.cache_raw_key = cacheState.rawKey;
            requestBody.cache_formatted_key = cacheState.formattedKey;
        } else if (content.length > 0) {
            requestBody.content = content;
        }

        if (currentMode === 'TEXT' && !requestBody.s3_source_key && !requestBody.content) {
            statusMessage.textContent = 'Text mode requires content.';
            return;
        }
    }

    if (currentMode === 'FILE' || currentMode === 'HYBRID') {
        if (files.length > 0) {
            requestBody.filenames = files.map(f => f.name);
        } else if (currentMode === 'FILE' && files.length === 0) {
            statusMessage.textContent = 'File mode requires at least one file.';
            return;
        }
    }

    try {
        let response = await fetch(`${API_BASE_URL}/store`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        let data = await response.json();

        if (!response.ok) {
            if (response.status === 409) {
                throw new Error(`The key '${customKey}' is already in use. Please choose another.`);
            }
            throw new Error(data.error || 'Store API call failed.');
        }

        const finalKey = data.key;

        // --- UI RESET & MODAL PREPARATION ---
        document.getElementById('custom-key').value = '';
        document.getElementById('store-form').reset();
        checkKeyAvailability();

        // Combined UI Cleanup: Stop timer and hide preview elements
        if (formatTimer) clearInterval(formatTimer);
        document.getElementById('preview-section').classList.add('hidden');

        const finalSelectionDiv = document.getElementById('final-source-selection');
        if (finalSelectionDiv) {
            finalSelectionDiv.classList.add('hidden');
        }

        cacheState = { rawKey: null, formattedKey: null, sourceToCommit: 'raw', timerEndTime: null };

        const shareUrl = `${window.location.origin}/retrieve.html?key=${finalKey}`;
        const modalKeyElement = document.getElementById('modal-result-key');
        const modalUrlElement = document.getElementById('modal-share-url');
        const modalFileMsg = document.getElementById('modal-file-message');

        modalKeyElement.textContent = finalKey;
        modalUrlElement.href = shareUrl;
        modalUrlElement.textContent = shareUrl;

        const successModal = document.getElementById('success-modal');
        successModal.classList.remove('hidden');
        successModal.style.display = 'flex';

        // 4. FILE UPLOAD EXECUTION (Client-side S3 POSTs) - Retains improved modal feedback
        const uploadInstructions = data.upload_instructions;

        if (uploadInstructions && uploadInstructions.length > 0 && files.length > 0) {
            modalFileMsg.textContent = "File upload initiated...";
            statusMessage.textContent = 'Metadata stored. Uploading files...';

            let allUploadsSuccessful = true;

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const instruction = uploadInstructions.find(inst => inst.filename === file.name);

                if (!instruction) {
                    allUploadsSuccessful = false;
                    continue;
                }

                const formData = new FormData();
                Object.keys(instruction.upload_fields).forEach(key => {
                    formData.append(key, instruction.upload_fields[key]);
                });
                formData.append('file', file);

                modalFileMsg.textContent = `Uploading file ${i + 1}/${files.length}: ${file.name}...`;

                let s3Response = await fetch(instruction.upload_url, {
                    method: 'POST',
                    body: formData,
                });

                if (!s3Response.ok) {
                    console.error(`S3 POST Failed for ${file.name}:`, s3Response.status, await s3Response.text());
                    statusMessage.textContent = `Warning: Metadata saved, but file upload failed for ${file.name}. Key: ${finalKey}.`;
                    allUploadsSuccessful = false;
                } else {
                    console.log(`Successfully uploaded ${file.name}.`);
                }
            } // ← Only ONE closing brace here (end of for loop)

            // Final Status Update (this must stay INSIDE the try block)
            if (allUploadsSuccessful) {
                statusMessage.textContent = `Success! All files and metadata stored with key: ${finalKey}`;
                modalFileMsg.textContent = 'All files uploaded successfully.';
            } else {
                statusMessage.textContent = `Warning: Files uploaded with errors. Metadata stored with key: ${finalKey}.`;
                modalFileMsg.textContent = 'Warning: Some files failed to upload.';
            }
        } else {
            statusMessage.textContent = `Success! Content stored with key: ${finalKey}`;
            modalFileMsg.textContent = "";
        }
    } catch (error) {
        console.error("Store Error:", error);
        statusMessage.textContent = `Error: ${error.message}`;
        document.getElementById('success-modal').style.display = 'none';
    }
}

// Function to load the content from the Presigned URL into the preview area (RETAINED)
window.fetchPreviewContent = async function(url) {
    const previewArea = document.getElementById('preview-content-area');
    previewArea.innerHTML = '<p class="text-center py-4 text-lg">Loading content...</p>';

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.status === 403) {
            throw new Error('S3 Access Denied. The temporary preview link may have expired immediately.');
        }
        if (!response.ok) {
            throw new Error(`Failed to fetch preview content. HTTP Status: ${response.status}`);
        }

        const content = await response.text();

        // Render the Markdown content
        const htmlContent = marked.parse(content);
        previewArea.innerHTML = htmlContent;

        // Highlight all code blocks after parsing
        document.querySelectorAll('#preview-content-area pre code').forEach((block) => {
            hljs.highlightElement(block);
        });

    } catch (error) {
        let errorMessage;
        if (error.name === 'AbortError') {
            errorMessage = 'Preview load timed out (15 seconds). Check network or S3 URL validity.';
        } else {
            errorMessage = `Error loading preview: ${error.message}.`;
        }

        previewArea.innerHTML = `<div class="p-4 bg-red-100 dark:bg-red-900 border border-red-400 rounded-lg">
                                    <p class="text-red-700 dark:text-red-300 font-semibold">${errorMessage}</p>
                                    <p class="text-xs mt-1 text-red-600 dark:text-red-400">If this persists, the backend Presigned URL is likely expired or invalid.</p>
                                </div>`;
    }
};

// Function to switch between raw and formatted preview tabs (RETAINED)
window.showPreviewContent = function(type) {
    const rawButton = document.getElementById('tab-raw');
    const formattedButton = document.getElementById('tab-formatted');

    const sourceFormatted = document.getElementById('source-formatted');
    const sourceRaw = document.getElementById('source-raw');

    if (!sourceFormatted || !sourceRaw) {
        console.error("Critical Error: Preview radio buttons missing from DOM.");
        return;
    }

    if (type === 'formatted') {
        sourceFormatted.checked = true;
        cacheState.sourceToCommit = 'formatted';
        fetchPreviewContent(cacheState.formattedPreviewUrl);

        formattedButton.classList.add('border-b-blue-600', 'dark:border-b-blue-400', 'text-blue-600', 'dark:text-blue-400');
        formattedButton.classList.remove('border-b-transparent', 'text-gray-500', 'dark:text-gray-400');

        rawButton.classList.remove('border-b-blue-600', 'dark:border-b-blue-400', 'text-blue-600', 'dark:text-blue-400');
        rawButton.classList.add('border-b-transparent', 'text-gray-500', 'dark:text-gray-400');
    } else {
        sourceRaw.checked = true;
        cacheState.sourceToCommit = 'raw';
        fetchPreviewContent(cacheState.rawPreviewUrl);

        rawButton.classList.add('border-b-blue-600', 'dark:border-b-blue-400', 'text-blue-600', 'dark:text-blue-400');
        rawButton.classList.remove('border-b-transparent', 'text-gray-500', 'dark:text-gray-400');

        formattedButton.classList.remove('border-b-blue-600', 'dark:border-b-blue-400', 'text-blue-600', 'dark:text-blue-400');
        formattedButton.classList.add('border-b-transparent', 'text-gray-500', 'dark:text-gray-400');
    }
};

// Function to start the 30-minute expiration timer (RETAINED)
function startPreviewTimer() {
    if (formatTimer) clearInterval(formatTimer);

    const timerElement = document.getElementById('preview-timer');
    const previewSection = document.getElementById('preview-section');
    const finalSelectionDiv = document.getElementById('final-source-selection');

    cacheState.timerEndTime = Date.now() + PREVIEW_DURATION_MS;

    formatTimer = setInterval(() => {
        const remaining = cacheState.timerEndTime - Date.now();

        if (remaining <= 0) {
            clearInterval(formatTimer);
            timerElement.textContent = 'Preview Expired. Please re-format to continue.';

            previewSection.classList.add('hidden');
            if (finalSelectionDiv) finalSelectionDiv.classList.add('hidden');

            document.getElementById('format-button').disabled = false;

            cacheState.rawKey = null;
            cacheState.formattedKey = null;

            statusMessage.textContent = 'Preview session expired. Click Format again if needed.';
            return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
        timerElement.textContent = `Preview expires in: ${minutes}m ${seconds}s`;
    }, 1000);
}

// REMOVED: enhanceCodeBlocks (User Request)