// src/webview/script.js
(function() {
    const vscode = acquireVsCodeApi(); // Get reference to VS Code API
    console.log('Webview script loaded.');

    // --- Get DOM Elements ---
    const instructionsTextarea = document.getElementById('instructions');
    const targetFilesInput = document.getElementById('targetFiles');
    const submitButton = document.getElementById('submitRequest');
    const responseArea = document.getElementById('responseArea');
    const statusArea = document.getElementById('statusArea');
    const fileListDiv = document.getElementById('fileList');
    const refreshFilesButton = document.getElementById('refreshFiles');
    const openFolderButton = document.getElementById('openFolderButton'); // <<< ADDED THIS LINE

    let selectedFiles = new Set();

    // --- Event Listener for "Open Folder" button ---
    if (openFolderButton) {
        console.log('Open Folder button element found.');
        openFolderButton.addEventListener('click', () => {
            console.log('Open Folder button clicked. Sending "openFolder" command to extension.');
            vscode.postMessage({
                command: 'openFolder'
            });
        });
    } else {
        console.error('ERROR: Open Folder button element (ID "openFolderButton") not found in the DOM!');
    }

    // Function to update targetFilesInput from selectedFiles set
    function updateTargetFilesInput() {
        if (targetFilesInput) {
            targetFilesInput.value = Array.from(selectedFiles).join(', ');
        }
    }

    // Populate file list
    function populateFileList(files, error) {
        if (!fileListDiv) {
            console.error("fileListDiv not found");
            return;
        }
        fileListDiv.innerHTML = ''; // Clear previous list
        if (error) {
            fileListDiv.textContent = `Error loading files: ${error}`;
            console.error(`Error loading files: ${error}`);
            return;
        }
        if (!files || files.length === 0) {
            fileListDiv.textContent = 'No files found in workspace or workspace not fully loaded.';
            return;
        }
        const ul = document.createElement('ul'); // Use a <ul> for semantic list
        files.sort().forEach(filePath => {
            const li = document.createElement('li'); // Use <li> for list items
            li.textContent = filePath;
            li.classList.add('file-list-item');
            li.title = `Click to add/remove '${filePath}' from Target Files`;

            if (selectedFiles.has(filePath)) {
                li.classList.add('selected');
            }

            li.addEventListener('click', () => {
                if (selectedFiles.has(filePath)) {
                    selectedFiles.delete(filePath);
                    li.classList.remove('selected');
                } else {
                    selectedFiles.add(filePath);
                    li.classList.add('selected');
                }
                updateTargetFilesInput();
            });
            ul.appendChild(li);
        });
        fileListDiv.appendChild(ul);
        console.log('File list populated.');
    }

    // --- Event Listener for "Submit Request" button ---
    if (submitButton && instructionsTextarea && targetFilesInput && responseArea && statusArea) {
        submitButton.addEventListener('click', () => {
            const instructions = instructionsTextarea.value;
            const targets = targetFilesInput.value;
            if (!instructions.trim()) {
                vscode.postMessage({ command: 'error', text: 'Please provide instructions.' });
                // Display error in webview too
                if(statusArea) statusArea.textContent = 'Error: Please provide instructions.';
                if(responseArea) {
                    responseArea.textContent = 'Error: Please provide instructions.';
                    responseArea.style.display = 'block';
                }
                return;
            }
            console.log('Submit button clicked. Sending "submitRequest".');
            vscode.postMessage({
                command: 'submitRequest',
                text: instructions,
                targetFiles: targets
            });
            responseArea.style.display = 'none';
            responseArea.textContent = '';
            statusArea.textContent = 'Sending request...';
        });
    } else {
        console.error('One or more elements for submit functionality are missing.');
    }

    // --- Event Listener for "Refresh Files" button ---
    if (refreshFilesButton && fileListDiv) {
        refreshFilesButton.addEventListener('click', () => {
            console.log('Refresh Files button clicked. Requesting workspace files.');
            fileListDiv.textContent = 'Refreshing file list...';
            vscode.postMessage({ command: 'getWorkspaceFiles' });
        });
    } else {
        console.error('Refresh Files button or fileListDiv not found.');
    }


    // --- Handle messages from the extension ---
    window.addEventListener('message', event => {
        const message = event.data; // The JSON data our extension sent
        console.log('Message received from extension:', message);

        if (!responseArea || !statusArea) {
            console.error("responseArea or statusArea is not available to display message.");
            return;
        }

        switch (message.command) {
            case 'response':
                responseArea.style.display = 'block';
                const responseMsg = typeof message.message === 'string' ? message.message : JSON.stringify(message.message);
                responseArea.textContent = `Success: ${message.success}\nMessage: ${responseMsg}`;
                statusArea.textContent = message.success ? 'Completed.' : 'Failed.';
                if (message.success) {
                    // Optionally clear inputs or give other success feedback
                }
                break;
            case 'statusUpdate':
                statusArea.textContent = message.message;
                break;
            case 'workspaceFiles':
                populateFileList(message.files, message.error);
                // Check targetFilesInput and re-apply selected class if files match
                if (targetFilesInput) {
                    const currentTargets = targetFilesInput.value.split(',').map(f => f.trim()).filter(f => f);
                    selectedFiles = new Set(currentTargets); // Re-initialize selectedFiles based on input
                    // Re-apply 'selected' class to list items
                    const listItems = fileListDiv.querySelectorAll('.file-list-item');
                    listItems.forEach(item => {
                        if (selectedFiles.has(item.textContent)) {
                            item.classList.add('selected');
                        } else {
                            item.classList.remove('selected');
                        }
                    });
                }
                break;
            case 'error': // General error from extension
                 responseArea.style.display = 'block';
                 responseArea.textContent = `Error: ${message.text || message.message}`; // Accommodate both `text` and `message`
                 statusArea.textContent = 'Error occurred.';
                 break;
        }
    });

    // --- Initial request for workspace files when webview loads ---
    console.log('Requesting initial workspace files.');
    vscode.postMessage({ command: 'getWorkspaceFiles' });

}());