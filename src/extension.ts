// extension.ts
import * as vscode from 'vscode';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Content } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs'; // Node.js fs for reading webview files

let webviewPanel: vscode.WebviewPanel | undefined;

// Define a type for conversation history items for clarity from webview
interface ChatMessage {
	role: 'user' | 'model' | 'system'; // 'system' role is for webview internal use, not directly for Gemini history array
	parts: Part[]; // Part is typically { text: string }
}

// --- START: Utility Functions ---
function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
	const htmlPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'main.html');
	const scriptPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'script.js');
	const scriptUri = webview.asWebviewUri(scriptPath);

	let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');
	// Replace placeholder with actual script URI
	htmlContent = htmlContent.replace('{{scriptUri}}', scriptUri.toString());
	return htmlContent;
}

async function sendWorkspaceFilesToWebview() {
	if (!webviewPanel) return;

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		webviewPanel.webview.postMessage({ command: 'workspaceFiles', files: [], error: "No workspace open." });
		return;
	}

	try {
		// Get all files, could be refined with .gitignore or include/exclude patterns
		const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 1000); // Limit to 1000 files
		const filePaths = files.map(file => vscode.workspace.asRelativePath(file.fsPath, false));
		webviewPanel.webview.postMessage({ command: 'workspaceFiles', files: filePaths });
	} catch (error: any) {
		console.error("Error fetching workspace files:", error);
		webviewPanel.webview.postMessage({ command: 'workspaceFiles', files: [], error: `Error fetching files: ${error.message || error}` });
	}
}

interface FileChange { // For parsing Gemini's response
	filePath: string;
	content: string;
}

function parseGeminiResponse(responseText: string): FileChange[] {
	const changes: FileChange[] = [];
	// Regex to find file blocks. Uses named capture groups.
	const fileBlockRegex = /```FILEPATH:\s*(?<filePath>[^\n]+)\s*<<FILE_CONTENT_START>>\s*(?<content>[\s\S]*?)\s*<<FILE_CONTENT_END>>\s*```/g;

	let match;
	while ((match = fileBlockRegex.exec(responseText)) !== null) {
		if (match.groups) {
			const filePath = match.groups.filePath.trim();
			let content = match.groups.content;
			// Remove potential leading/trailing newlines that might be artifacts
			content = content.replace(/^\s*\n|\n\s*$/g, '');
			changes.push({ filePath, content });
		}
	}
	return changes;
}
// --- END: Utility Functions ---


export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "gemini-code-editor" is now active!');
	console.log('TEST!');

	let disposable = vscode.commands.registerCommand('gemini-code-editor.start', () => {
		const columnToShowIn = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (webviewPanel) {
			webviewPanel.reveal(columnToShowIn);
		} else {
			webviewPanel = vscode.window.createWebviewPanel(
				'geminiCodeEditor', // Identifies the type of the webview. Used internally
				'Gemini: Chat Edit Codebase', // Title of the panel displayed to the user
				vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
				{
					enableScripts: true, // Allow scripts to run in the webview
					retainContextWhenHidden: true, // Keep state when webview is not visible
					localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'webview')]
				}
			);

			webviewPanel.webview.html = getWebviewContent(context, webviewPanel.webview);

			webviewPanel.onDidDispose(
				() => {
					console.log('[EXTENSION] Webview panel disposed.');
					webviewPanel = undefined;
				},
				null,
				context.subscriptions
			);

			// Handle messages from the webview
			webviewPanel.webview.onDidReceiveMessage(
				async message => {
					console.log('[EXTENSION] Message received from webview command:', message.command); // Log just command for brevity initially
					switch (message.command) {
						case 'submitChatRequest':
							await handleChatRequest(message.conversation, message.targetFiles);
							return;
						case 'getWorkspaceFiles':
							await sendWorkspaceFilesToWebview();
							return;
						case 'openFolder':
							console.log('[EXTENSION] Processing "openFolder" command.');
							vscode.commands.executeCommand('vscode.openFolder');
							return;
						case 'error': // Errors sent from webview's caught exceptions
							vscode.window.showErrorMessage(`Webview reported error: ${message.text || message.message}`);
							return;
					}
				},
				undefined,
				context.subscriptions
			);
		}
	});

	context.subscriptions.push(disposable);
}

async function handleChatRequest(
	rawConversationFromWebview: ChatMessage[],
	targetFilesInput: string
) {
	if (!webviewPanel) {
		console.error('[EXTENSION] handleChatRequest called but webviewPanel is undefined.');
		return;
	}

	const apiKey = vscode.workspace.getConfiguration('gemini-code-editor').get<string>('apiKey');
	const modelName = vscode.workspace.getConfiguration('gemini-code-editor').get<string>('modelName');

	if (!apiKey || !modelName) {
		const missing = !apiKey && !modelName ? 'API Key and Model Name' : !apiKey ? 'API Key' : 'Model Name';
		const errorMsg = `${missing} not configured. Please set it in VS Code settings.`;
		vscode.window.showErrorMessage(errorMsg);
		webviewPanel.webview.postMessage({ command: 'chatResponse', success: false, text: errorMsg });
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		const errorMsg = 'No workspace folder open.';
		vscode.window.showErrorMessage(errorMsg);
		webviewPanel.webview.postMessage({ command: 'chatResponse', success: false, text: errorMsg });
		return;
	}

	webviewPanel.webview.postMessage({ command: 'statusUpdate', message: 'Processing request with Gemini...' });

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({ model: modelName });

		let fileContextPromptPart = "";
		const targetFilesArray = targetFilesInput.split(',').map(f => f.trim()).filter(f => f);

		if (targetFilesArray.length > 0) {
			webviewPanel.webview.postMessage({ command: 'statusUpdate', message: `Reading target files: ${targetFilesArray.join(', ')}` });
			let fileContentsForPrompt = "";
			for (const relativeFilePath of targetFilesArray) {
				try {
					const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativeFilePath);
					const fileContentBytes = await vscode.workspace.fs.readFile(fileUri);
					const fileContent = new TextDecoder().decode(fileContentBytes);
					fileContentsForPrompt += `\n\n--- START FILE: ${relativeFilePath} ---\n${fileContent}\n--- END FILE: ${relativeFilePath} ---`;
				} catch (error: any) {
					console.warn(`[EXTENSION] Could not read file: ${relativeFilePath}`, error);
					fileContentsForPrompt += `\n\n--- START FILE: ${relativeFilePath} ---\n// File not found or could not be read: ${error.message || error}\n--- END FILE: ${relativeFilePath} ---`;
				}
			}
			if (fileContentsForPrompt) {
				fileContextPromptPart = `\n\nRelevant file contents for this request:\n${fileContentsForPrompt}`;
			}
		} else {
			fileContextPromptPart = "\n\nNo specific files were targeted for this request. Infer from conversation or ask if needed.";
		}

		if (rawConversationFromWebview.length === 0) {
			console.error('[EXTENSION] Received empty conversation history from webview.');
			webviewPanel.webview.postMessage({ command: 'chatResponse', success: false, text: 'Error: Conversation history is empty.' });
			return;
		}
		const currentUserMessageFromHistory = rawConversationFromWebview[rawConversationFromWebview.length - 1];
		if (currentUserMessageFromHistory.role !== 'user') {
			console.error('[EXTENSION] Last message in conversation history is not from user.');
			webviewPanel.webview.postMessage({ command: 'chatResponse', success: false, text: 'Error: Internal - last message expected to be user.' });
			return;
		}
		const userInstructionText = currentUserMessageFromHistory.parts.map(p => p.text).join('\n');

		// --- Construct API-Compliant History ---
		let historyForGemini: Content[] = [];
		const allMessagesBeforeCurrent = rawConversationFromWebview.slice(0, -1);
		const firstUserMsgIndex = allMessagesBeforeCurrent.findIndex(m => m.role === 'user');

		if (firstUserMsgIndex !== -1) {
			let lastRoleProcessedForApi: 'user' | 'model' | null = null;
			for (let i = firstUserMsgIndex; i < allMessagesBeforeCurrent.length; i++) {
				const msg = allMessagesBeforeCurrent[i];
				if (msg.role === 'system') continue; // System messages are not part of Gemini's `history` array

				const currentRole = msg.role as ('user' | 'model');

				if (currentRole === 'user' && (lastRoleProcessedForApi === null || lastRoleProcessedForApi === 'model')) {
					historyForGemini.push({ role: 'user', parts: msg.parts });
					lastRoleProcessedForApi = 'user';
				}
				else if (currentRole === 'model' && lastRoleProcessedForApi === 'user') {
					historyForGemini.push({ role: 'model', parts: msg.parts });
					lastRoleProcessedForApi = 'model';
				}
			}
		}
		// --- End History Construction ---

		const workspaceContextInstruction = `
The user is working within a VS Code workspace. You can create new files or modify existing files relative to the root of this workspace.
If no file is specified, assume the files are in the workspace root (/).
You have access to the file system of this workspace to create, read, and write files.`; // Added a bit more emphasis


		const systemAndUserPrompt = `You are an expert AI programmer assisting with code modifications in a VS Code workspace.
${workspaceContextInstruction}
The user will provide instructions through a chat interface.
${fileContextPromptPart}


IMPORTANT INSTRUCTIONS FOR YOUR RESPONSE if you are making file changes:
1.  Analyze the request, conversation history (if provided), and the provided file contents (if any).
2.  For each file you need to create or modify, provide its full new content.
3.  Format your response as follows:
    For EACH file:
    \`\`\`FILEPATH: path/to/your/file.ext
    <<FILE_CONTENT_START>>
    // ... full new content of the file ...
    <<FILE_CONTENT_END>>
    \`\`\`
    Replace \`path/to/your/file.ext\` with the correct relative path from the workspace root.
    Ensure the content between \`<<FILE_CONTENT_START>>\` and \`<<FILE_CONTENT_END>>\` is the complete, new content for that file.
    If you are creating a new file, provide its path and content.
    If you are modifying an existing file, provide its path and the *entire new content* of that file after modifications.
    If no files need to be changed, respond with "No changes needed based on the request." or a conversational answer.
    If you need more information, ask clarifying questions.

Provide only the file blocks as described IF making file changes. Otherwise, respond naturally.
Converse naturally if the user is asking questions or discussing the project without explicit file change instructions.

User's current query: "${userInstructionText}"`;

		webviewPanel.webview.postMessage({ command: 'statusUpdate', message: 'Sending prompt to Gemini...' });
		console.log('[EXTENSION] Sending to Gemini. API History for this turn (length ' + historyForGemini.length + '):',
			JSON.stringify(historyForGemini.map(h => ({ role: h.role, textStart: h.parts[0].text?.substring(0, 50) + '...' }))));
		// console.log('[EXTENSION] Current prompt being sent to Gemini (first 200 chars):', systemAndUserPrompt.substring(0, 200));


		const generationConfig = { maxOutputTokens: 8192 };
		const safetySettings = [
			{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
			{ category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
			{ category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
			{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
		];

		const chat = model.startChat({
			generationConfig,
			safetySettings,
			history: historyForGemini, // Use the carefully constructed history
		});

		console.log(systemAndUserPrompt);
		const result = await chat.sendMessage(systemAndUserPrompt); // Send the current user's turn
		const responseText = result.response.text();

		webviewPanel.webview.postMessage({ command: 'statusUpdate', message: 'Received response from Gemini. Processing...' });
		console.log("[EXTENSION] Gemini Chat Response Raw:", responseText.substring(0, 200) + "..."); // Log snippet

		const fileChanges = parseGeminiResponse(responseText);

		if (fileChanges.length > 0) {
			for (const change of fileChanges) {
				const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, change.filePath);
				const contentBytes = new TextEncoder().encode(change.content);
				try {
					const dirPath = path.dirname(change.filePath);
					if (dirPath !== '.' && dirPath !== '') {
						const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, dirPath);
						if (dirUri.fsPath !== workspaceFolder.uri.fsPath) { // Avoid trying to create workspace root
							try {
								await vscode.workspace.fs.stat(dirUri);
							} catch { // Directory does not exist
								console.log(`[EXTENSION] Directory ${dirPath} does not exist. Creating...`);
								await vscode.workspace.fs.createDirectory(dirUri);
								webviewPanel.webview.postMessage({ command: 'statusUpdate', message: `Created directory: ${dirPath}` });
							}
						}
					}
					await vscode.workspace.fs.writeFile(fileUri, contentBytes);
					const updateMessage = `File updated/created: ${change.filePath}`;
					vscode.window.showInformationMessage(updateMessage);
					webviewPanel.webview.postMessage({ command: 'statusUpdate', message: `Applied change: ${change.filePath}` });
				} catch (e: any) {
					const errorMsg = `Error writing file ${change.filePath}: ${e.message}`;
					console.error(`[EXTENSION] ${errorMsg}`, e);
					vscode.window.showErrorMessage(errorMsg);
					// Send error related to this specific file change back to chat
					webviewPanel.webview.postMessage({ command: 'chatResponse', success: false, text: errorMsg });
				}
			}
		} else if (responseText.toLowerCase().includes("no changes needed")) {
			vscode.window.showInformationMessage('Gemini: No changes needed.');
		}

		// Send the full response text from Gemini to be displayed in the chat
		webviewPanel.webview.postMessage({ command: 'chatResponse', success: true, text: responseText });

		if (fileChanges.length > 0) {
			vscode.window.showInformationMessage('Codebase updated successfully based on Gemini suggestions.');
		}

	} catch (error: any) {
		console.error("[EXTENSION] Error with Gemini chat request:", error);
		let errorMsg = `Error processing chat request: ${error.message || 'Unknown error'}`;
		if (error.response && error.response.promptFeedback) {
			errorMsg += ` (Prompt Feedback: ${JSON.stringify(error.response.promptFeedback)})`;
		} else if (error.message && error.message.includes(" candidats")) { // Gemini often returns this for safety blocks
			errorMsg += " (This may be due to safety settings blocking the response or a malformed request)";
		}
		vscode.window.showErrorMessage(errorMsg);
		if (webviewPanel) {
			webviewPanel.webview.postMessage({ command: 'chatResponse', success: false, text: errorMsg });
		}
	}
}

export function deactivate() {
	if (webviewPanel) {
		webviewPanel.dispose();
	}
	console.log('Extension "gemini-code-editor" is now deactivated.');
}