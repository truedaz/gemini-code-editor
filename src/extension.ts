import * as vscode from 'vscode';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import * as path from 'path';
import * as fs from 'fs'; // Node.js fs for reading webview files

let webviewPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "gemini-code-editor" is now active!');

	let disposable = vscode.commands.registerCommand('gemini-code-editor.start', () => {
		const columnToShowIn = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		if (webviewPanel) {
			webviewPanel.reveal(columnToShowIn);
		} else {
			webviewPanel = vscode.window.createWebviewPanel(
				'geminiCodeEditor', // Identifies the type of the webview. Used internally
				'Gemini: Edit Codebase', // Title of the panel displayed to the user
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
					webviewPanel = undefined;
				},
				null,
				context.subscriptions
			);

			// Handle messages from the webview
			webviewPanel.webview.onDidReceiveMessage(
				async message => {
					switch (message.command) {
						case 'submitRequest':
							await handleGeminiRequest(message.text, message.targetFiles);
							return;
						case 'getWorkspaceFiles':
							await sendWorkspaceFilesToWebview();
							return;
						case 'error':
							vscode.window.showErrorMessage(message.text);
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
	} catch (error) {
		console.error("Error fetching workspace files:", error);
		webviewPanel.webview.postMessage({ command: 'workspaceFiles', files: [], error: `Error fetching files: ${error}` });
	}
}


async function handleGeminiRequest(userInstructions: string, targetFilesInput: string) {
	if (!webviewPanel) return;

	const apiKey = vscode.workspace.getConfiguration('gemini-code-editor').get<string>('apiKey');
	const modelName = vscode.workspace.getConfiguration('gemini-code-editor').get<string>('modelName');

	if (!apiKey) {
		vscode.window.showErrorMessage('Gemini API Key not configured. Please set it in VS Code settings.');
		webviewPanel.webview.postMessage({ command: 'response', success: false, message: 'API Key not configured.' });
		return;
	}
	if (!modelName) {
		vscode.window.showErrorMessage('Gemini Model Name not configured. Please set it in VS Code settings.');
		webviewPanel.webview.postMessage({ command: 'response', success: false, message: 'Model Name not configured.' });
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder open.');
		webviewPanel.webview.postMessage({ command: 'response', success: false, message: 'No workspace folder open.' });
		return;
	}

	webviewPanel.webview.postMessage({ command: 'statusUpdate', message: 'Processing request with Gemini...' });

	try {
		const genAI = new GoogleGenerativeAI(apiKey);
		const model = genAI.getGenerativeModel({ model: modelName });

		let fileContext = "";
		const targetFilesArray = targetFilesInput.split(',').map(f => f.trim()).filter(f => f);

		if (targetFilesArray.length > 0) {
			webviewPanel.webview.postMessage({ command: 'statusUpdate', message: `Reading target files: ${targetFilesArray.join(', ')}` });
			for (const relativeFilePath of targetFilesArray) {
				try {
					const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativeFilePath);
					const fileContentBytes = await vscode.workspace.fs.readFile(fileUri);
					const fileContent = new TextDecoder().decode(fileContentBytes);
					fileContext += `\n\n--- START FILE: ${relativeFilePath} ---\n${fileContent}\n--- END FILE: ${relativeFilePath} ---`;
				} catch (error) {
					console.warn(`Could not read file: ${relativeFilePath}`, error);
					fileContext += `\n\n--- START FILE: ${relativeFilePath} ---\n// File not found or could not be read.\n--- END FILE: ${relativeFilePath} ---`;
				}
			}
		} else {
			webviewPanel.webview.postMessage({ command: 'statusUpdate', message: 'No specific target files provided. Relying on instructions only.' });
		}

		// --- CRITICAL: PROMPT ENGINEERING ---
		const prompt = `
You are an expert AI programmer assisting with code modifications in a VS Code workspace.
The user wants to make the following changes:
${userInstructions}

${fileContext.length > 0 ? `Here is the current content of relevant files:\n${fileContext}` : "The user has not provided specific file contents upfront. Infer or ask if necessary."}

IMPORTANT INSTRUCTIONS FOR YOUR RESPONSE:
1.  Analyze the request and the provided file contents (if any).
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
    If no files need to be changed, respond with "No changes needed based on the request."

Example of a valid response structure for modifying one file and creating another:
\`\`\`FILEPATH: src/utils.ts
<<FILE_CONTENT_START>>
export function newUtilityFunction() {
  console.log("This is a new utility function.");
}

export function existingFunction() {
  // updated logic
  return 1 + 1;
}
<<FILE_CONTENT_END>>
\`\`\`
\`\`\`FILEPATH: new_module/component.js
<<FILE_CONTENT_START>>
// This is a brand new component
class MyComponent {
  constructor() {
    this.name = "MyComponent";
  }
}
export default MyComponent;
<<FILE_CONTENT_END>>
\`\`\`

Provide only the file blocks as described. Do not include any other explanatory text outside these blocks unless it's "No changes needed...".
`;

		webviewPanel.webview.postMessage({ command: 'statusUpdate', message: 'Sending prompt to Gemini...' });

		// For text-only input, use the gemini-pro model
		const generationConfig = {
			// temperature: 0.9, // Be creative
			// topK: 1,
			// topP: 1,
			maxOutputTokens: 8192, // Adjust as needed; Flash has 8192 output
		};
		const safetySettings = [
			{ category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
			{ category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
			{ category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
			{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
		];

		const chat = model.startChat({
			generationConfig,
			safetySettings,
			history: [], // You can build history if you want conversational edits
		});

		const result = await chat.sendMessage(prompt);
		const responseText = result.response.text();

		webviewPanel.webview.postMessage({ command: 'statusUpdate', message: 'Received response from Gemini. Parsing and applying changes...' });
		console.log("Gemini Response Raw:", responseText);

		// --- PARSING GEMINI'S RESPONSE ---
		const fileChanges = parseGeminiResponse(responseText);

		if (fileChanges.length === 0 && !responseText.toLowerCase().includes("no changes needed")) {
			vscode.window.showWarningMessage('Gemini did not provide changes in the expected format.');
			webviewPanel.webview.postMessage({ command: 'response', success: false, message: 'Gemini response not in expected format. Raw response: \n' + responseText });
			return;
		}
		if (responseText.toLowerCase().includes("no changes needed")) {
			vscode.window.showInformationMessage('Gemini indicated no changes needed.');
			webviewPanel.webview.postMessage({ command: 'response', success: true, message: 'Gemini: No changes needed.' });
			return;
		}


		for (const change of fileChanges) {
			const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, change.filePath);
			const contentBytes = new TextEncoder().encode(change.content);
			try {
				await vscode.workspace.fs.writeFile(fileUri, contentBytes);
				vscode.window.showInformationMessage(`File updated/created: ${change.filePath}`);
				webviewPanel.webview.postMessage({ command: 'statusUpdate', message: `Applied changes to: ${change.filePath}` });
			} catch (e: any) {
				vscode.window.showErrorMessage(`Error writing file ${change.filePath}: ${e.message}`);
				webviewPanel.webview.postMessage({ command: 'error', message: `Error writing file ${change.filePath}: ${e.message}` });
				// Potentially try to create parent directories if error is about non-existent path
				if (e.code === 'ENOENT' || (e.message && e.message.includes('ENOENT'))) {
					const dirPath = path.dirname(change.filePath);
					if (dirPath !== '.') { // Avoid trying to create current directory
						const dirUri = vscode.Uri.joinPath(workspaceFolder.uri, dirPath);
						try {
							await vscode.workspace.fs.createDirectory(dirUri); // Recursive creation is not standard, so this might fail for nested new dirs
							console.log(`Created directory: ${dirPath}`);
							// Retry writing the file
							await vscode.workspace.fs.writeFile(fileUri, contentBytes);
							vscode.window.showInformationMessage(`File updated/created after creating directory: ${change.filePath}`);
							webviewPanel.webview.postMessage({ command: 'statusUpdate', message: `Applied changes to: ${change.filePath} (after creating directory)` });
						} catch (dirError: any) {
							vscode.window.showErrorMessage(`Error creating directory ${dirPath} for ${change.filePath}: ${dirError.message}`);
							webviewPanel.webview.postMessage({ command: 'error', message: `Error creating directory for ${change.filePath}: ${dirError.message}` });
						}
					}
				}
			}
		}

		webviewPanel.webview.postMessage({ command: 'response', success: true, message: 'Codebase updated successfully based on Gemini suggestions.' });
		vscode.window.showInformationMessage('Codebase updated successfully!');

	} catch (error: any) {
		console.error("Error with Gemini request:", error);
		vscode.window.showErrorMessage(`Error processing request: ${error.message || error}`);
		if (webviewPanel) {
			webviewPanel.webview.postMessage({ command: 'response', success: false, message: `Error: ${error.message || error}` });
		}
	}
}

interface FileChange {
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


export function deactivate() {
	if (webviewPanel) {
		webviewPanel.dispose();
	}
}