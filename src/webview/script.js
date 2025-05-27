// This script will run in the webview
(function() {
  const vscode = acquireVsCodeApi(); // Get reference to VS Code API

  const instructionsTextarea = document.getElementById('instructions');
  const targetFilesInput = document.getElementById('targetFiles');
  const submitButton = document.getElementById('submitRequest');
  const responseArea = document.getElementById('responseArea');
  const statusArea = document.getElementById('statusArea');
  const fileListDiv = document.getElementById('fileList');
  const refreshFilesButton = document.getElementById('refreshFiles');

  let selectedFiles = new Set();

  // Function to update targetFilesInput from selectedFiles set
  function updateTargetFilesInput() {
      targetFilesInput.value = Array.from(selectedFiles).join(', ');
  }

  // Populate file list
  function populateFileList(files, error) {
      fileListDiv.innerHTML = ''; // Clear previous list
      if (error) {
          fileListDiv.textContent = `Error loading files: ${error}`;
          return;
      }
      if (files.length === 0) {
          fileListDiv.textContent = 'No files found in workspace or workspace not fully loaded.';
          return;
      }
      files.sort().forEach(filePath => {
          const fileItem = document.createElement('div');
          fileItem.textContent = filePath;
          fileItem.classList.add('file-list-item');
          if (selectedFiles.has(filePath)) {
              fileItem.classList.add('selected');
          }
          fileItem.addEventListener('click', () => {
              if (selectedFiles.has(filePath)) {
                  selectedFiles.delete(filePath);
                  fileItem.classList.remove('selected');
              } else {
                  selectedFiles.add(filePath);
                  fileItem.classList.add('selected');
              }
              updateTargetFilesInput();
          });
          fileListDiv.appendChild(fileItem);
      });
  }


  submitButton.addEventListener('click', () => {
      const instructions = instructionsTextarea.value;
      const targets = targetFilesInput.value;
      if (!instructions.trim()) {
          vscode.postMessage({ command: 'error', text: 'Please provide instructions.' });
          return;
      }
      vscode.postMessage({
          command: 'submitRequest',
          text: instructions,
          targetFiles: targets
      });
      responseArea.style.display = 'none';
      responseArea.textContent = '';
      statusArea.textContent = 'Sending request...';
  });

  refreshFilesButton.addEventListener('click', () => {
      fileListDiv.textContent = 'Refreshing file list...';
      vscode.postMessage({ command: 'getWorkspaceFiles' });
  });


  // Handle messages from the extension
  window.addEventListener('message', event => {
      const message = event.data; // The JSON data our extension sent
      switch (message.command) {
          case 'response':
              responseArea.style.display = 'block';
              responseArea.textContent = `Success: ${message.success}\nMessage: ${message.message}`;
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
              break;
          case 'error': // General error from extension
               responseArea.style.display = 'block';
               responseArea.textContent = `Error: ${message.text}`;
               statusArea.textContent = 'Error occurred.';
               break;
      }
  });

  // Request workspace files when webview loads
  vscode.postMessage({ command: 'getWorkspaceFiles' });

}());