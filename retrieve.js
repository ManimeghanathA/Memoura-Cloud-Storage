// retrieve.js (Dedicated logic for the Retrieve Page, V103)

const API_BASE_URL = "https://lj6mh0lwni.execute-api.us-east-1.amazonaws.com";


// Declare global references (initialized in DOMContentLoaded)
let passwordGate;
let passwordGateForm;
let gateStatus;
let statusMessage;
let retrieveForm;

document.addEventListener('DOMContentLoaded', function() {
    // Assign references ONLY after the DOM is ready
    retrieveForm = document.getElementById('retrieve-form');
    passwordGate = document.getElementById('password-gate');
    passwordGateForm = document.getElementById('password-gate-form');
    gateStatus = document.getElementById('gate-status');
    statusMessage = document.getElementById('status-message');

    // Attach the event listeners
    retrieveForm.addEventListener('submit', handleRetrieveSubmit);
    passwordGateForm.addEventListener('submit', handlePasswordGateSubmit);

    // Initial check for deep linking via URL query parameter
    checkForDeepLinkKey();
});


// Helper to inject VS Code style bar and icon into code blocks
function enhanceCodeBlocks(containerId) {
    const codeBlocks = document.querySelectorAll(`#${containerId} pre code`);

    codeBlocks.forEach(codeElement => {
        if (codeElement.closest('.code-block-wrapper')) {
            return; 
        }
        
        const languageMatch = Array.from(codeElement.classList).find(cls => cls.startsWith('language-'));
        const language = languageMatch ? languageMatch.replace('language-', '').toUpperCase() : 'TEXT';
        const rawCode = codeElement.textContent;

        const utilityBar = document.createElement('div');
        utilityBar.classList.add('code-utility-bar');
        const languageLabel = document.createElement('span');
        languageLabel.textContent = language;
        utilityBar.appendChild(languageLabel); 

        const copyButton = document.createElement('button');
        copyButton.classList.add('copy-icon-button');
        copyButton.innerHTML = `
            <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-copy">
                <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5c-.138 0-.25.112-.25.25v7.5c0 .138.112.25.25.25h7.5c.138 0 .25-.112.25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
            </svg>
        `;
        // Handle copy action for code blocks
        copyButton.onclick = () => {
            // Use document.execCommand('copy') for better compatibility
            const tempInput = document.createElement('textarea');
            tempInput.value = rawCode;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);

            const originalHTML = copyButton.innerHTML;
            copyButton.innerHTML = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" class="octicon octicon-check"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0l-3.25-3.25a.75.75 0 0 1 1.06-1.06l2.72 2.72 6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
            copyButton.style.backgroundColor = '#28a745'; // Green success color
            
            setTimeout(() => {
                copyButton.innerHTML = originalHTML;
                copyButton.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; 
            }, 1500);
        };
        
        const preElement = codeElement.parentElement; 
        const wrapper = document.createElement('div');
        wrapper.classList.add('code-block-wrapper');

        preElement.parentNode.insertBefore(wrapper, preElement);
        
        wrapper.appendChild(utilityBar);
        wrapper.appendChild(preElement);
        wrapper.appendChild(copyButton); 
    });
}

// Function to toggle password visibility (Remains globally exposed)
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


function checkForDeepLinkKey() {
    const urlParams = new URLSearchParams(window.location.search);
    const key = urlParams.get('key');
    
    if (key) {
        // Pre-fill the key input
        document.getElementById('retrieve-key').value = key;
        // Attempt retrieval immediately with an empty password
        attemptRetrieval(key, null, true); 
    }
}


function handlePasswordGateSubmit(e) {
    e.preventDefault();
    gateStatus.textContent = '';
    
    const key = document.getElementById('retrieve-key').value;
    const password = document.getElementById('gate-password').value;
    
    if (!password) {
        gateStatus.textContent = 'Please enter a password.';
        return;
    }
    
    // Set retrieve-password hidden field for use in attemptRetrieval
    document.getElementById('retrieve-password').value = password; 
    
    // Re-attempt retrieval with the provided password
    attemptRetrieval(key, password, false);
}


async function handleRetrieveSubmit(e) {
    e.preventDefault();
    statusMessage.textContent = '';
    
    const key = document.getElementById('retrieve-key').value.toUpperCase();
    const password = document.getElementById('retrieve-password').value; 
    
    // Hide the gate and show the form (default state)
    passwordGate.classList.add('hidden');
    retrieveForm.classList.remove('hidden');

    attemptRetrieval(key, password, false);
}


async function attemptRetrieval(key, password, isDeepLink) {
    statusMessage.textContent = isDeepLink ? `Attempting to retrieve content for key: ${key}...` : 'Retrieving content...';
    document.getElementById('retrieve-result').classList.add('hidden');

    const finalPassword = password || document.getElementById('retrieve-password').value;
    const body = finalPassword ? JSON.stringify({ password: finalPassword }) : '';

    try {
        let response = await fetch(`${API_BASE_URL}/retrieve/${key}`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        // 1. Check for Password Protection (401)
        if (response.status === 401) {
            retrieveForm.classList.add('hidden');
            passwordGate.classList.remove('hidden');
            gateStatus.textContent = 'This content is password protected.';
            statusMessage.textContent = '';
            
            if (isDeepLink) {
                document.getElementById('gate-password').focus();
            }
            return; 
        }
        
        let data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Retrieve API call failed.');

        // 2. Success: Hide gate and display content.
        passwordGate.classList.add('hidden');

        document.getElementById('retrieved-mode').textContent = data.upload_mode;
        document.getElementById('retrieved-expires').textContent = new Date(data.expires * 1000).toLocaleString();
        document.getElementById('retrieve-result').classList.remove('hidden');
        
        const textOutputGroup = document.getElementById('text-output-group');
        const fileOutputGroup = document.getElementById('file-output-group');
        const fileLinksContainer = document.getElementById('file-links-container');

        // Reset display groups
        textOutputGroup.classList.add('hidden');
        fileOutputGroup.classList.add('hidden');
        fileLinksContainer.innerHTML = ''; 

        // 3. FILE OUTPUT LOGIC
        if (data.files && data.files.length > 0) {
            fileOutputGroup.classList.remove('hidden');
            
            data.files.forEach((fileData) => {
                const link = document.createElement('a');
                link.href = fileData.download_url;
                link.target = "_blank";
                
                // Style the file link button using the consistent black/white theme
                link.classList.add(
                    "flex", "items-center", "justify-between", "p-3", "rounded-lg",
                    "bg-black", "text-white", "hover:bg-gray-800", "transition-colors",
                    "dark:bg-white", "dark:text-black", "dark:hover:bg-gray-200"
                );
                link.innerHTML = `
                    <span class="font-medium text-base">${fileData.filename}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 fill-current" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.707-8.707a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V3a1 1 0 10-2 0v7.586L6.707 8.293z" clip-rule="evenodd" />
                    </svg>
                `;
                fileLinksContainer.appendChild(link);
            });
            statusMessage.textContent = 'Content retrieved.';
        } 
        
        // 4. TEXT OUTPUT LOGIC
        if (data.content) {
            textOutputGroup.classList.remove('hidden');
            
            const htmlContent = marked.parse(data.content);
            document.getElementById('content-preview').innerHTML = htmlContent;

            // Highlight code blocks
            document.querySelectorAll('#content-preview pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
            
            // Apply code block styling
            enhanceCodeBlocks('content-preview'); 
            
            statusMessage.textContent = 'Content retrieved.';
        }
        
        if (!data.content && !(data.files && data.files.length > 0)) {
            statusMessage.textContent = 'Retrieved data contains no file or text content.';
        }
        

    } catch (error) {
        console.error("Retrieve Error:", error);
        statusMessage.textContent = `Error: ${error.message}`;
        document.getElementById('retrieve-result').classList.add('hidden');
        
        // Reset to initial state on error
        if (!passwordGate.classList.contains('hidden')) {
            passwordGate.classList.add('hidden');
            retrieveForm.classList.remove('hidden');
        }
    }
}
