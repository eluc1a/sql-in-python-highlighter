# SQL in Python Highlighter - Implementation Plan

## Executive Summary

Both requested features are **fully implementable** without over-engineering:
1. **Grammar Fix**: Simple regex pattern adjustment (10 minutes)
2. **SQL Formatter**: Standard VS Code extension pattern (2-3 hours)

## Issue 1: Grammar Boundary Fix

### Problem
SQL syntax highlighting bleeds past the triple-quoted string boundary, affecting the rest of the Python file or Jupyter cell.

### Root Cause
The TextMate grammar's regex pattern isn't properly terminating at the closing triple quotes. The current pattern captures the beginning correctly but the scope continues past the end delimiter.

### Solution
Modify `/syntaxes/sql-in-python.tmLanguage.json`:

```json
{
  "fileTypes": [],
  "injectionSelector": "L:source.python -comment -string.quoted.single",
  "patterns": [
    {
      "include": "#sql-triple-quoted-double"
    },
    {
      "include": "#sql-triple-quoted-single"
    }
  ],
  "repository": {
    "sql-triple-quoted-double": {
      "begin": "(\"\"\")(\\s*--sql\\b)",
      "beginCaptures": {
        "1": { "name": "punctuation.definition.string.begin.python" },
        "2": { "name": "comment.line.sql-marker.python" }
      },
      "end": "(\"\"\")",
      "endCaptures": {
        "1": { "name": "punctuation.definition.string.end.python" }
      },
      "contentName": "meta.embedded.block.sql",
      "patterns": [
        { "include": "source.sql" }
      ]
    },
    "sql-triple-quoted-single": {
      "begin": "(''')(\\s*--sql\\b)",
      "beginCaptures": {
        "1": { "name": "punctuation.definition.string.begin.python" },
        "2": { "name": "comment.line.sql-marker.python" }
      },
      "end": "(''')",
      "endCaptures": {
        "1": { "name": "punctuation.definition.string.end.python" }
      },
      "contentName": "meta.embedded.block.sql",
      "patterns": [
        { "include": "source.sql" }
      ]
    }
  },
  "scopeName": "source.python.embedded.sql"
}
```

### Testing
Use VS Code's "Developer: Inspect Editor Tokens and Scopes" to verify correct scope termination.

## Issue 2: SQL Formatter Implementation

### Architecture Overview

```
extension.js
├── activate()
│   ├── Register formatting providers
│   ├── Register command
│   └── Configure formatter
├── SqlFormatter class
│   ├── detectSqlBlocks()
│   ├── formatSql()
│   └── applyEdits()
└── deactivate()
```

### Phase 1: Core Setup

#### 1.1 Dependencies
Add to `package.json`:
```json
"dependencies": {
  "sql-formatter": "^15.0.0"
}
```

#### 1.2 Command Registration
Add to `package.json`:
```json
"contributes": {
  "commands": [
    {
      "command": "sql-in-python.formatSql",
      "title": "Format SQL"
    }
  ],
  "keybindings": [
    {
      "command": "sql-in-python.formatSql",
      "key": "shift+alt+f",
      "when": "editorTextFocus && resourceExtname =~ /\\.(py|sql|ipynb)/"
    }
  ]
}
```

### Phase 2: Formatter Implementation

#### 2.1 Main Extension File Structure
```javascript
// extension.js
const vscode = require('vscode');
const { format } = require('sql-formatter');

class SqlFormatter {
  constructor() {
    this.formatConfig = {
      language: 'sql',
      uppercase: true,
      indent: '    ',
      linesBetweenQueries: 2
    };
  }

  // Detect SQL blocks in Python/Jupyter files
  detectSqlBlocks(document) {
    const text = document.getText();
    const sqlBlocks = [];
    
    // Pattern for triple-quoted strings with --sql
    const regex = /"""(\s*--sql\b[\s\S]*?)"""|'''(\s*--sql\b[\s\S]*?)'''/g;
    
    let match;
    while ((match = regex.exec(text)) !== null) {
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const sqlContent = match[1] || match[2];
      
      sqlBlocks.push({
        range: new vscode.Range(startPos, endPos),
        content: sqlContent,
        fullMatch: match[0]
      });
    }
    
    return sqlBlocks;
  }

  // Format SQL with custom rules
  formatSql(sqlText) {
    try {
      // Remove --sql marker for formatting
      const cleanSql = sqlText.replace(/^\s*--sql\b/, '');
      
      // Apply sql-formatter
      let formatted = format(cleanSql, this.formatConfig);
      
      // Custom post-processing for specific patterns
      formatted = this.applyCustomRules(formatted);
      
      // Re-add --sql marker
      return '--sql\n' + formatted;
    } catch (error) {
      vscode.window.showErrorMessage(`SQL formatting failed: ${error.message}`);
      return null;
    }
  }

  // Apply custom formatting rules to match sample pattern
  applyCustomRules(sql) {
    // Ensure commas at the beginning of lines in SELECT
    sql = sql.replace(/,\n\s+/g, '\n    ,');
    
    // Align CASE statements
    sql = sql.replace(/WHEN\s+/g, '        WHEN ');
    sql = sql.replace(/THEN\s+/g, ' THEN ');
    sql = sql.replace(/ELSE\s+/g, '        ELSE ');
    
    // Ensure proper CTE formatting
    sql = sql.replace(/\),\s*\n\s*(\w+)\s+AS\s+\(/g, '),\n\n$1 AS (');
    
    return sql;
  }

  // Provide formatting for entire document
  provideDocumentFormattingEdits(document) {
    const edits = [];
    
    if (document.languageId === 'sql') {
      // Format entire SQL file
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      const formatted = this.formatSql(document.getText());
      if (formatted) {
        edits.push(vscode.TextEdit.replace(fullRange, formatted));
      }
    } else if (document.languageId === 'python') {
      // Format SQL blocks in Python
      const sqlBlocks = this.detectSqlBlocks(document);
      for (const block of sqlBlocks) {
        const formatted = this.formatSql(block.content);
        if (formatted) {
          const newText = block.fullMatch.replace(block.content, formatted);
          edits.push(vscode.TextEdit.replace(block.range, newText));
        }
      }
    }
    
    return edits;
  }

  // Provide formatting for selection
  provideDocumentRangeFormattingEdits(document, range) {
    const selectedText = document.getText(range);
    
    // Check if selection contains SQL
    if (this.looksLikeSql(selectedText)) {
      const formatted = this.formatSql(selectedText);
      if (formatted) {
        return [vscode.TextEdit.replace(range, formatted)];
      }
    }
    
    return [];
  }

  // Heuristic to detect if text is SQL
  looksLikeSql(text) {
    const sqlKeywords = /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|WITH|JOIN|UNION|CREATE|ALTER|DROP)\b/i;
    return sqlKeywords.test(text);
  }
}

function activate(context) {
  console.log('SQL in Python Highlighter with Formatter is now active');
  
  const formatter = new SqlFormatter();
  
  // Register formatting providers
  const sqlProvider = vscode.languages.registerDocumentFormattingEditProvider(
    'sql', formatter
  );
  const pythonProvider = vscode.languages.registerDocumentFormattingEditProvider(
    'python', formatter
  );
  const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    ['sql', 'python'], formatter
  );
  
  // Register command
  const formatCommand = vscode.commands.registerCommand(
    'sql-in-python.formatSql',
    () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        if (editor.selection.isEmpty) {
          vscode.commands.executeCommand('editor.action.formatDocument');
        } else {
          vscode.commands.executeCommand('editor.action.formatSelection');
        }
      }
    }
  );
  
  context.subscriptions.push(sqlProvider, pythonProvider, rangeProvider, formatCommand);
}

module.exports = { activate, deactivate };
```

### Phase 3: Jupyter Notebook Support

For `.ipynb` files, extend the formatter to handle JSON structure:

```javascript
// Add to SqlFormatter class
formatJupyterCell(cellContent) {
  // Parse cell content and format SQL blocks
  const sqlPattern = /"""(\s*--sql\b[\s\S]*?)"""|'''(\s*--sql\b[\s\S]*?)'''/g;
  return cellContent.replace(sqlPattern, (match, p1, p2) => {
    const sqlContent = p1 || p2;
    const formatted = this.formatSql(sqlContent);
    return formatted ? match.replace(sqlContent, formatted) : match;
  });
}
```

### Phase 4: Testing Strategy

1. **Grammar Testing**:
   - Create test files with SQL blocks followed by Python code
   - Verify highlighting stops at string boundaries
   - Test with both `"""` and `'''` delimiters

2. **Formatter Testing**:
   - Test with sample SQL from `docs/sample_query_for_formatting.sql`
   - Test selection formatting vs. full document
   - Test error handling with invalid SQL
   - Test preservation of Python code around SQL blocks

### Implementation Timeline

- **Day 1**: 
  - Fix grammar issue (30 min)
  - Set up formatter infrastructure (1 hour)
  
- **Day 2**:
  - Implement SQL detection and formatting (2 hours)
  - Add Jupyter support (1 hour)
  
- **Day 3**:
  - Testing and refinement (2 hours)
  - Documentation update (30 min)

## Risk Mitigation

1. **SQL Detection False Positives**: Use conservative heuristics, require explicit `--sql` marker
2. **Formatting Errors**: Wrap all formatter calls in try-catch, preserve original on error
3. **Performance**: Use TextEdit for efficient document updates
4. **Compatibility**: Test with various VS Code versions

## Success Criteria

- [ ] SQL highlighting stops at string boundaries
- [ ] Formatter accessible via Command Palette
- [ ] Keyboard shortcut works
- [ ] Formats .sql, .py, and .ipynb files
- [ ] Only formats SQL portions
- [ ] Keywords are uppercase
- [ ] Follows sample formatting pattern
- [ ] Error handling prevents data loss