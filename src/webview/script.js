// src/webview/script.js
(function () {
    const vscode = acquireVsCodeApi();
    console.log('Webview script loaded (Chat Mode).');

    // --- Get DOM Elements ---
    const messageInput = document.getElementById('messageInput');
    const targetFilesInput = document.getElementById('targetFiles');
    const sendMessageButton = document.getElementById('sendMessage');
    const chatArea = document.getElementById('chatArea');
    const statusArea = document.getElementById('statusArea');
    const fileListDiv = document.getElementById('fileList');
    const refreshFilesButton = document.getElementById('refreshFiles');
    const openFolderButton = document.getElementById('openFolderButton');

    let conversationHistory = [
        // Optional: Initialize with a system message or the first greeting
        // { role: 'system', parts: [{ text: "You are an AI assistant helping with code." }] },
        { role: 'model', parts: [{ text: "Hello! How can I help you modify your codebase today?" }] } // Matches initial HTML
    ];
    let selectedFiles = new Set(); // For managing target files UI

    // --- Helper to add message to chat display ---
    function appendMessageToChat(sender, text) {
        if (!chatArea) return;
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('chat-message');
        messageDiv.classList.add(sender.toLowerCase()); // 'user' or 'gemini'

        // Simple text display for now. Could be enhanced to render markdown or code blocks.
        // For Gemini responses that might contain file blocks, we'll handle special parsing later
        // or expect the extension to format it nicely before sending to webview.
        // For now, let's assume 'text' is display-ready.
        if (sender.toLowerCase() === 'gemini' && text.includes('```FILEPATH')) {
            // Basic handling to make file blocks slightly more readable if they slip through
            const parts = text.split(/(```FILEPATH:[\s\S]*?<<FILE_CONTENT_END>>```)/g);
            parts.forEach(part => {
                if (part.startsWith('```FILEPATH')) {
                    const pre = document.createElement('pre');
                    pre.textContent = part;
                    messageDiv.appendChild(pre);
                } else if (part.trim()) {
                    const p = document.createElement('p');
                    p.textContent = part.trim();
                    messageDiv.appendChild(p);
                }
            });
        } else {
            messageDiv.textContent = text;
        }

        chatArea.appendChild(messageDiv);
        chatArea.scrollTop = chatArea.scrollHeight; // Scroll to bottom
    }

    // --- Event Listener for "Open Folder" button ---
    if (openFolderButton) {
        openFolderButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'openFolder' });
        });
    }

    // --- Function to update targetFilesInput from selectedFiles set ---
    function updateTargetFilesInput() {
        if (targetFilesInput) {
            targetFilesInput.value = Array.from(selectedFiles).join(', ');
        }
    }

    // --- Populate file list (for target files selection) ---
    function populateFileList(files, error) {
        // (This function remains largely the same as your previous version)
        if (!fileListDiv) {
            console.error("fileListDiv not found");
            return;
        }
        fileListDiv.innerHTML = '';
        if (error) {
            fileListDiv.textContent = `Error loading files: ${error}`;
            return;
        }
        if (!files || files.length === 0) {
            fileListDiv.textContent = 'No files found or workspace not fully loaded.';
            return;
        }
        const ul = document.createElement('ul');
        files.sort().forEach(filePath => {
            const li = document.createElement('li');
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
    }


    // --- Event Listener for "Send Message" button ---
    if (sendMessageButton && messageInput && targetFilesInput && statusArea) {
        sendMessageButton.addEventListener('click', () => {
            const userMessageText = messageInput.value.trim();
            const currentTargetFiles = targetFilesInput.value.trim();

            if (!userMessageText) {
                statusArea.textContent = 'Please enter a message.';
                return;
            }

            appendMessageToChat('user', userMessageText);
            conversationHistory.push({ role: 'user', parts: [{ text: userMessageText }] });

            statusArea.textContent = 'Sending to Gemini...';
            vscode.postMessage({
                command: 'submitChatRequest', // New command
                conversation: conversationHistory,
                targetFiles: currentTargetFiles // Send current target files with this message
            });

            messageInput.value = ''; // Clear input
            // Optionally, clear targetFilesInput after each message or let user manage it
            // targetFilesInput.value = '';
            // selectedFiles.clear();
            // populateFileList(lastFetchedFiles || [], null); // Re-render file list to clear selections
        });

        // Allow sending with Enter key in textarea (Shift+Enter for new line)
        messageInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault(); // Prevent new line
                sendMessageButton.click(); // Trigger button click
            }
        });

    } else {
        console.error('One or more elements for chat send functionality are missing.');
    }

    // --- Event Listener for "Refresh Files" button ---
    if (refreshFilesButton) {
        refreshFilesButton.addEventListener('click', () => {
            if (fileListDiv) fileListDiv.textContent = 'Refreshing file list...';
            vscode.postMessage({ command: 'getWorkspaceFiles' });
        });
    }

    // --- Handle messages from the extension ---
    let lastFetchedFiles = []; // To re-render file list selection status
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Message received from extension (Chat Mode):', message);

        switch (message.command) {
            case 'chatResponse': // New response command
                if (statusArea) statusArea.textContent = message.success ? 'Gemini responded.' : 'Error in Gemini response.';
                if (message.text) {
                    appendMessageToChat('gemini', message.text);
                    conversationHistory.push({ role: 'model', parts: [{ text: message.text }] });
                }
                if (message.processedMessage) { // If extension pre-processes the display message
                    statusArea.textContent = "Applied changes. See details above.";
                }
                break;
            case 'statusUpdate':
                if (statusArea) statusArea.textContent = message.message;
                break;
            case 'workspaceFiles':
                if (fileListDiv && statusArea) {
                    lastFetchedFiles = message.files || [];
                    populateFileList(lastFetchedFiles, message.error);
                    // Re-apply 'selected' class based on current targetFilesInput
                    const currentTargets = targetFilesInput.value.split(',').map(f => f.trim()).filter(f => f);
                    selectedFiles = new Set(currentTargets);
                    const listItems = fileListDiv.querySelectorAll('.file-list-item');
                    listItems.forEach(item => {
                        if (selectedFiles.has(item.textContent)) item.classList.add('selected');
                        else item.classList.remove('selected');
                    });
                    if (!message.error) statusArea.textContent = 'Workspace files loaded.';
                }
                break;
            case 'error': // General error from extension, show in status
                if (statusArea) statusArea.textContent = `Error: ${message.text || message.message}`;
                // Could also append an error message to chatArea
                appendMessageToChat('gemini', `Error from extension: ${message.text || message.message}`);
                break;
        }
    });

    // --- Initial request for workspace files ---
    vscode.postMessage({ command: 'getWorkspaceFiles' });
    if (statusArea) statusArea.textContent = "Chat ready. Describe your task or ask a question.";

}());