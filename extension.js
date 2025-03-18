const vscode = require('vscode');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('SQL in Python Highlighter extension is now active');
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}

