const vscode = require('vscode');
const { format } = require('sql-formatter');

class SqlFormatter {
    constructor() {
        this.formatConfig = {
            language: 'bigquery',  // Use BigQuery dialect for better support
            keywordCase: 'upper',
            dataTypeCase: 'upper', 
            functionCase: 'upper',
            tabWidth: 4,
            useTabs: false,
            linesBetweenQueries: 2
        };
    }

    detectSqlBlocks(document) {
        const text = document.getText();
        const sqlBlocks = [];
        
        // Pattern for triple-quoted strings with --sql (including f-strings)
        const regex = /f?"""(\s*--sql\b[\s\S]*?)"""|f?'''(\s*--sql\b[\s\S]*?)'''/g;
        
        let match;
        while ((match = regex.exec(text)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const sqlContent = match[1] || match[2];
            
            sqlBlocks.push({
                range: new vscode.Range(startPos, endPos),
                content: sqlContent,
                fullMatch: match[0],
                quotes: match[0].startsWith('"""') ? '"""' : "'''"
            });
        }
        
        return sqlBlocks;
    }

    formatSql(sqlText) {
        try {
            // Remove --sql marker for formatting
            const cleanSql = sqlText.replace(/^\s*--sql\b/, '').trim();
            
            // Use a custom formatter that handles CTEs and CASE statements properly
            let formatted = this.customFormat(cleanSql);
            
            // Re-add --sql marker if it was present
            const hadSqlMarker = /^\s*--sql\b/.test(sqlText);
            const result = hadSqlMarker ? '--sql\n' + formatted : formatted;
            
            return result;
        } catch (error) {
            console.error('SQL formatting error:', error);
            vscode.window.showErrorMessage(`SQL formatting failed: ${error.message}`);
            return null;
        }
    }

    customFormat(sql) {
        // First apply sql-formatter for basic formatting
        let formatted = format(sql, this.formatConfig);
        
        // Now apply our custom rules to fix the issues
        formatted = this.fixCTEFormatting(formatted);
        formatted = this.fixCaseFormatting(formatted);
        formatted = this.fixBigQueryIdentifiers(formatted);
        formatted = this.fixWhereClause(formatted);
        formatted = this.fixJoinIndentation(formatted);
        formatted = this.fixCommaPlacement(formatted);
        
        return formatted;
    }
    
    fixCTEFormatting(sql) {
        // Fix WITH statement formatting and indentation
        // The sql-formatter outputs WITH on one line, then name AS ( on the next
        
        // First pass: combine WITH and name AS ( on one line
        sql = sql.replace(/WITH\s*\n\s+(\w+)\s+AS\s*\(/gi, 'WITH $1 AS (');
        
        // Second pass: fix indentation inside ALL CTEs
        // We need to process CTEs in order, so let's find them all first
        const ctePattern = /(\w+\s+AS\s*\()([\s\S]*?)(\n\s*\))/gi;
        const ctes = [];
        let match;
        
        // Find all potential CTEs
        while ((match = ctePattern.exec(sql)) !== null) {
            const beforeMatch = sql.substring(0, match.index);
            const lines = beforeMatch.split('\n');
            const lastLine = lines[lines.length - 1];
            
            // Check if this is actually a CTE
            // It's a CTE if preceded by WITH, comma, or it's part of a CTE chain
            const isCTE = /WITH\s+$/.test(lastLine) ||  // WITH name AS (
                         /,\s*$/.test(beforeMatch.trim()) ||  // ), name AS (
                         /\),?\s*$/.test(lines[lines.length - 2] || '') ||  // Check previous line for ),
                         match.index === 0;  // Start of string
            
            if (isCTE) {
                ctes.push({
                    fullMatch: match[0],
                    opening: match[1],
                    content: match[2],
                    closing: match[3],
                    index: match.index
                });
            }
        }
        
        // Process CTEs in reverse order to preserve indices
        for (let i = ctes.length - 1; i >= 0; i--) {
            const cte = ctes[i];
            
            // Check if this CTE itself is indented (second+ CTEs)
            const leadingSpaces = sql.substring(0, cte.index).split('\n').pop().match(/^\s*/)[0].length;
            
            const lines = cte.content.split('\n');
            const fixedLines = [];
            
            for (let j = 0; j < lines.length; j++) {
                const line = lines[j];
                const trimmed = line.trim();
                
                if (trimmed === '') {
                    if (fixedLines.length > 0) {
                        fixedLines.push('');
                    }
                } else {
                    const spaces = line.match(/^\s*/)[0].length;
                    // Reduce indentation by 4 spaces for content at 8+
                    // This preserves relative indentation for nested structures
                    if (spaces >= 8) {
                        fixedLines.push(' '.repeat(spaces - 4) + trimmed);
                    } else {
                        // Content at less than 8 spaces gets set to 4
                        fixedLines.push('    ' + trimmed);
                    }
                }
            }
            
            // Remove leading empty lines
            while (fixedLines.length > 0 && fixedLines[0] === '') {
                fixedLines.shift();
            }
            
            // Now fix AND/OR indentation relative to WHERE
            const adjustedLines = [];
            let whereIndent = null;
            for (let j = 0; j < fixedLines.length; j++) {
                const line = fixedLines[j];
                const trimmed = line.trim();
                
                if (/^\s*WHERE\b/i.test(line)) {
                    whereIndent = line.match(/^\s*/)[0].length;
                    adjustedLines.push(line);
                } else if (/^\s*(AND|OR)\b/i.test(line) && whereIndent !== null) {
                    // AND/OR should be at WHERE + 4
                    const currentSpaces = line.match(/^\s*/)[0].length;
                    if (currentSpaces < whereIndent + 4) {
                        adjustedLines.push(' '.repeat(whereIndent + 4) + trimmed);
                    } else {
                        adjustedLines.push(line);
                    }
                } else {
                    adjustedLines.push(line);
                }
            }
            
            const replacement = cte.opening + '\n' + adjustedLines.join('\n') + '\n)';
            sql = sql.substring(0, cte.index) + replacement + sql.substring(cte.index + cte.fullMatch.length);
        }
        
        // Handle multiple CTEs - add blank line between them
        sql = sql.replace(/\),\s*\n\s*(\w+)\s+AS\s*\(/gi, '),\n\n$1 AS (');
        
        return sql;
    }

    fixCaseFormatting(sql) {
        // Fix CASE statement formatting
        const lines = sql.split('\n');
        const result = [];
        let i = 0;
        
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Check if this line contains CASE
            if (/\bCASE\b/i.test(trimmed) && !/\bEND\b/i.test(trimmed)) {
                // Find where CASE appears in the line
                const caseIndex = line.toUpperCase().indexOf('CASE');
                const lineBeforeCase = line.substring(0, caseIndex);
                
                // Keep everything before CASE (including indentation and any field name/comma)
                if (lineBeforeCase.trim()) {
                    // CASE is preceded by something (like a comma)
                    result.push(line);
                } else {
                    // CASE starts the line - keep its current indentation
                    result.push(line);
                }
                i++;
                
                // Process following lines until we hit END
                let caseDepth = 1;
                const caseIndent = lineBeforeCase.match(/^\s*/)[0];
                let lastWasWhen = false;
                
                while (i < lines.length && caseDepth > 0) {
                    const nextLine = lines[i];
                    const nextTrimmed = nextLine.trim();
                    
                    // Track nested CASE statements
                    if (/\bCASE\b/i.test(nextTrimmed) && !/\bEND\b/i.test(nextTrimmed)) {
                        caseDepth++;
                        result.push(nextLine);
                        lastWasWhen = false;
                    } else if (/\bEND\b/i.test(nextTrimmed)) {
                        caseDepth--;
                        if (caseDepth === 0) {
                            // This is our closing END - align with CASE
                            const endParts = nextTrimmed.match(/^(END)(.*)$/i);
                            if (endParts) {
                                result.push(caseIndent + endParts[1] + endParts[2]);
                            } else {
                                result.push(caseIndent + nextTrimmed);
                            }
                        } else {
                            // This is a nested END
                            result.push(nextLine);
                        }
                        lastWasWhen = false;
                    } else if (caseDepth === 1) {
                        // Only format the outermost CASE content
                        if (/^WHEN\b/i.test(nextTrimmed)) {
                            // Don't add blank line between WHEN clauses
                            result.push(caseIndent + '    ' + nextTrimmed);
                            lastWasWhen = true;
                        } else if (/^AND\b/i.test(nextTrimmed) || /^OR\b/i.test(nextTrimmed)) {
                            result.push(caseIndent + '        ' + nextTrimmed);
                            lastWasWhen = false;
                        } else if (/^THEN\b/i.test(nextTrimmed)) {
                            result.push(caseIndent + '    ' + nextTrimmed);
                            lastWasWhen = false;
                        } else if (/^ELSE\b/i.test(nextTrimmed)) {
                            // Don't add blank line before ELSE
                            result.push(caseIndent + '    ' + nextTrimmed);
                            lastWasWhen = false;
                        } else if (nextTrimmed === '') {
                            // Skip blank lines between WHEN clauses
                            if (!lastWasWhen) {
                                result.push('');
                            }
                        } else {
                            // Some other content inside CASE
                            result.push(nextLine);
                            lastWasWhen = false;
                        }
                    } else {
                        // Content in nested CASE
                        result.push(nextLine);
                        lastWasWhen = false;
                    }
                    i++;
                }
            } else {
                result.push(line);
                i++;
            }
        }
        
        return result.join('\n');
    }

    fixBigQueryIdentifiers(sql) {
        // Fix BigQuery project IDs with hyphens
        // First, fix backtick-quoted identifiers
        sql = sql.replace(/`([^`]+)`/g, (match, content) => {
            // Remove ALL spaces around ALL hyphens and dots within backticks
            let fixed = content;
            // Keep replacing until no more spaces around hyphens
            while (fixed.includes(' - ') || fixed.includes('- ') || fixed.includes(' -')) {
                fixed = fixed.replace(/\s+-\s+/g, '-');
                fixed = fixed.replace(/\s+-/g, '-');
                fixed = fixed.replace(/-\s+/g, '-');
            }
            // Also fix dots
            fixed = fixed.replace(/\s+\.\s+/g, '.');
            fixed = fixed.replace(/\s+\./g, '.');
            fixed = fixed.replace(/\.\s+/g, '.');
            return '`' + fixed + '`';
        });
        
        // Fix non-backticked BigQuery references
        sql = sql.replace(/(\w+(?:\s*-\s*\w+)*)\s*\.\s*(\w+(?:\s*-\s*\w+)*)\s*\.\s*(\w+)/g, (match, project, dataset, table) => {
            // Check if this is actually a BigQuery reference (has hyphens or looks like one)
            if (project.includes('-') || dataset.includes('-')) {
                // Remove all spaces around hyphens in each part
                const fixedProject = project.replace(/\s*-\s*/g, '-');
                const fixedDataset = dataset.replace(/\s*-\s*/g, '-');
                const fixedTable = table.replace(/\s*-\s*/g, '-');
                return fixedProject + '.' + fixedDataset + '.' + fixedTable;
            }
            return match;
        });
        
        return sql;
    }

    fixWhereClause(sql) {
        // Fix WHERE clause - ensure 1=1 pattern
        // We need to be context-aware about indentation
        const lines = sql.split('\n');
        const result = [];
        let currentWhereIndent = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Check if this is a WHERE line
            if (/^\s*WHERE\b/i.test(line)) {
                const whereIndent = line.match(/^\s*/)[0].length;
                currentWhereIndent = whereIndent;
                
                // Check if WHERE 1 = 1 pattern
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1];
                    const nextTrimmed = nextLine.trim();
                    
                    if (/^1\s*=\s*1$/i.test(nextTrimmed)) {
                        // WHERE followed by 1 = 1
                        result.push(line + ' 1 = 1');
                        i++; // Skip the 1 = 1 line
                        
                        // Process all following AND/OR lines
                        while (i + 1 < lines.length && /^\s*(AND|OR)\b/i.test(lines[i + 1])) {
                            const andLine = lines[i + 1];
                            const andTrimmed = andLine.trim();
                            // Place AND/OR at WHERE + 4
                            result.push(' '.repeat(whereIndent + 4) + andTrimmed);
                            i++; // Skip the AND/OR line
                        }
                    } else if (/^[^(]/.test(nextTrimmed) && !/^1\s*=\s*1/i.test(nextTrimmed)) {
                        // WHERE followed by a condition (not a subquery)
                        // Add 1 = 1 pattern
                        result.push(line + ' 1 = 1');
                        result.push(' '.repeat(whereIndent + 4) + 'AND ' + nextTrimmed);
                        i++; // Skip the next line
                        
                        // Process any following AND/OR lines
                        while (i + 1 < lines.length && /^\s*(AND|OR)\b/i.test(lines[i + 1])) {
                            const andLine = lines[i + 1];
                            const andTrimmed = andLine.trim();
                            result.push(' '.repeat(whereIndent + 4) + andTrimmed);
                            i++;
                        }
                    } else {
                        result.push(line);
                    }
                } else {
                    result.push(line);
                }
            } else if (currentWhereIndent !== null && /^\s*(AND|OR)\b/i.test(line)) {
                // Handle AND/OR that may have wrong indentation after WHERE 1=1
                const trimmed = line.trim();
                const expectedIndent = currentWhereIndent + 4;
                const actualIndent = line.match(/^\s*/)[0].length;
                
                if (actualIndent !== expectedIndent) {
                    result.push(' '.repeat(expectedIndent) + trimmed);
                } else {
                    result.push(line);
                }
            } else {
                result.push(line);
                // Reset WHERE tracking if we hit a new statement
                if (/^\s*(SELECT|FROM|GROUP|ORDER|HAVING|LIMIT|WITH)\b/i.test(line)) {
                    currentWhereIndent = null;
                }
            }
        }
        
        return result.join('\n');
    }

    fixJoinIndentation(sql) {
        // Fix JOIN statements to be at the same level as FROM
        const lines = sql.split('\n');
        const result = [];
        let fromIndent = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Track FROM indentation
            if (/^\s*FROM\b/i.test(line)) {
                fromIndent = line.match(/^\s*/)[0].length;
                result.push(line);
            } 
            // Fix JOIN indentation to match FROM
            else if (/^\s*(LEFT|RIGHT|INNER|OUTER|FULL|CROSS)?\s*JOIN\b/i.test(line) && fromIndent !== null) {
                const currentIndent = line.match(/^\s*/)[0].length;
                if (currentIndent !== fromIndent) {
                    // Adjust JOIN to match FROM indentation
                    result.push(' '.repeat(fromIndent) + trimmed);
                } else {
                    result.push(line);
                }
            } else {
                result.push(line);
                // Reset fromIndent if we hit a new query section
                if (/^\s*(SELECT|WITH)\b/i.test(line)) {
                    fromIndent = null;
                }
            }
        }
        
        return result.join('\n');
    }

    fixCommaPlacement(sql) {
        // Ensure commas at the beginning of lines for SELECT fields
        sql = sql.replace(/,\n(\s+)([A-Za-z_])/g, '\n$1,$2');
        
        return sql;
    }

    looksLikeSql(text) {
        const sqlKeywords = /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|WITH|JOIN|UNION|CREATE|ALTER|DROP|CASE|WHEN|THEN)\b/i;
        return sqlKeywords.test(text);
    }

    formatJupyterCell(cellContent) {
        // Format SQL blocks within a Jupyter cell
        const sqlPattern = /"""(\s*--sql\b[\s\S]*?)"""|'''(\s*--sql\b[\s\S]*?)'''/g;
        return cellContent.replace(sqlPattern, (match, p1, p2) => {
            const sqlContent = p1 || p2;
            const formatted = this.formatSql(sqlContent);
            const quotes = match.startsWith('"""') ? '"""' : "'''";
            return formatted ? quotes + formatted + quotes : match;
        });
    }

    provideDocumentFormattingEdits(document) {
        const edits = [];
        
        if (document.languageId === 'sql') {
            // Format entire SQL file (no --sql marker needed)
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            const text = document.getText();
            
            // Use the actual SQL formatter
            const formatted = this.formatSql(text);
            if (formatted && formatted !== text) {
                edits.push(vscode.TextEdit.replace(fullRange, formatted));
            }
        } else if (document.languageId === 'python' || document.languageId === 'jupyter') {
            // Check if this is a notebook file
            if (document.fileName.endsWith('.ipynb')) {
                // Handle Jupyter notebook
                try {
                    const text = document.getText();
                    const notebook = JSON.parse(text);
                    
                    if (notebook.cells) {
                        let modified = false;
                        notebook.cells = notebook.cells.map(cell => {
                            if (cell.cell_type === 'code' && cell.source) {
                                const sourceText = Array.isArray(cell.source) 
                                    ? cell.source.join('') 
                                    : cell.source;
                                
                                if (this.looksLikeSql(sourceText) || sourceText.includes('--sql')) {
                                    const formatted = this.formatJupyterCell(sourceText);
                                    if (formatted !== sourceText) {
                                        modified = true;
                                        // Preserve the array format if it was originally an array
                                        cell.source = Array.isArray(cell.source) 
                                            ? formatted.split('\n').map((line, i, arr) => 
                                                i === arr.length - 1 ? line : line + '\n')
                                            : formatted;
                                    }
                                }
                            }
                            return cell;
                        });
                        
                        if (modified) {
                            const fullRange = new vscode.Range(
                                document.positionAt(0),
                                document.positionAt(text.length)
                            );
                            edits.push(vscode.TextEdit.replace(
                                fullRange, 
                                JSON.stringify(notebook, null, 1)
                            ));
                        }
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to parse notebook: ${error.message}`);
                }
            } else {
                // Format SQL blocks in regular Python files
                const sqlBlocks = this.detectSqlBlocks(document);
                for (const block of sqlBlocks) {
                    const formatted = this.formatSql(block.content);
                    if (formatted) {
                        // Reconstruct the full string with quotes
                        const newText = block.quotes + formatted + block.quotes;
                        edits.push(vscode.TextEdit.replace(block.range, newText));
                    }
                }
            }
        }
        
        return edits;
    }

    provideDocumentRangeFormattingEdits(document, range) {
        const selectedText = document.getText(range);
        
        // Check if selection contains SQL
        if (this.looksLikeSql(selectedText)) {
            // Check if it already has --sql marker
            const hasSqlMarker = /^\s*--sql\b/i.test(selectedText);
            const textToFormat = hasSqlMarker ? selectedText : '--sql\n' + selectedText;
            
            const formatted = this.formatSql(textToFormat);
            if (formatted) {
                // Remove --sql marker if it wasn't originally there
                const finalText = hasSqlMarker ? formatted : formatted.replace(/^--sql\n/, '');
                return [vscode.TextEdit.replace(range, finalText)];
            }
        }
        
        return [];
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('SQL in Python Highlighter with Formatter is now active');
    
    // Verify sql-formatter is loaded
    try {
        const testFormat = format('select 1', { keywordCase: 'upper' });
        console.log('sql-formatter test successful:', testFormat);
    } catch (error) {
        console.error('sql-formatter failed to load:', error);
        vscode.window.showErrorMessage('SQL Formatter failed to load. Please reinstall the extension.');
        return;
    }
    
    const formatter = new SqlFormatter();
    
    // Register formatting providers with proper selectors
    const sqlProvider = vscode.languages.registerDocumentFormattingEditProvider(
        { scheme: 'file', language: 'sql' }, 
        formatter
    );
    const pythonProvider = vscode.languages.registerDocumentFormattingEditProvider(
        { scheme: 'file', language: 'python' }, 
        formatter
    );
    const jupyterProvider = vscode.languages.registerDocumentFormattingEditProvider(
        { scheme: 'file', pattern: '**/*.ipynb' }, 
        formatter
    );
    const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
        [
            { scheme: 'file', language: 'sql' },
            { scheme: 'file', language: 'python' },
            { scheme: 'file', pattern: '**/*.ipynb' }
        ], 
        formatter
    );
    
    // Register command that directly formats
    const formatCommand = vscode.commands.registerCommand(
        'sql-in-python.formatSql',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active text editor');
                return;
            }
            
            const document = editor.document;
            const selection = editor.selection;
            
            // Get the edits from our formatter directly
            let edits;
            if (selection.isEmpty) {
                // Format whole document
                edits = formatter.provideDocumentFormattingEdits(document);
            } else {
                // Format selection
                edits = formatter.provideDocumentRangeFormattingEdits(document, selection);
            }
            
            // Apply the edits
            if (edits && edits.length > 0) {
                const workspaceEdit = new vscode.WorkspaceEdit();
                for (const edit of edits) {
                    workspaceEdit.replace(document.uri, edit.range, edit.newText);
                }
                await vscode.workspace.applyEdit(workspaceEdit);
                vscode.window.showInformationMessage('SQL formatted successfully');
            } else {
                vscode.window.showInformationMessage('No formatting changes needed');
            }
        }
    );
    
    context.subscriptions.push(sqlProvider, pythonProvider, jupyterProvider, rangeProvider, formatCommand);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
}

