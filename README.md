# SQL in Python Highlighter

A VS Code extension that provides SQL syntax highlighting and formatting for SQL code embedded in Python strings, including support for Jupyter notebooks.

## Features

### SQL Syntax Highlighting
- Highlights SQL syntax within Python triple-quoted strings marked with `--sql`
- Supports both regular strings and f-strings
- Works in `.py` files and Jupyter notebooks (`.ipynb`)
- No bleeding of syntax highlighting beyond string boundaries

### SQL Formatting
- Formats SQL code with customizable rules
- Accessible via Command Palette or keyboard shortcut
- Smart formatting that preserves BigQuery-specific syntax

## Installation

1. Install the extension from the VSIX file:
   ```bash
   code --install-extension sql-in-python-highlighter-0.2.0.vsix
   ```

2. Reload VS Code window: `Cmd+Shift+P` → "Developer: Reload Window"

## Usage

### Syntax Highlighting

Mark your SQL strings with `--sql` comment:

```python
# Regular strings
query = """--sql
SELECT * FROM users
WHERE status = 'active'
"""

# F-strings with variables
user_id = 123
query = f"""--sql
SELECT * FROM users
WHERE id = {user_id}
"""
```

### SQL Formatting

Format your SQL using:
- **Keyboard Shortcut**: `Shift+Alt+F` (when in .sql, .py, or .ipynb files)
- **Command Palette**: `Cmd+Shift+P` → "Format SQL"

#### Formatting Features:
- **UPPERCASE** SQL keywords (SELECT, FROM, WHERE, etc.)
- **4-space indentation** throughout
- **BigQuery support**: Preserves project IDs like `my-project.dataset.table`
- **CTE formatting**: Keeps `WITH name AS (` on one line with proper indentation
- **WHERE clause pattern**: Automatically adds `WHERE 1 = 1` for cleaner AND conditions

### Example

**Before formatting:**
```sql
select * from `my-project-id.dataset.table` where status = 'active' and created_at > '2024-01-01'
```

**After formatting:**
```sql
SELECT
    *
FROM
    `my-project-id.dataset.table`
WHERE 1 = 1
    AND status = 'active'
    AND created_at > '2024-01-01'
```

## Supported File Types

- `.py` - Python files
- `.ipynb` - Jupyter notebooks
- `.sql` - SQL files

## Configuration

To set this extension as your default SQL formatter in VS Code, add to your settings.json:

```json
{
    "[sql]": {
        "editor.defaultFormatter": "eluc1a.sql-in-python-highlighter"
    }
}
```

## Version History

### 0.2.0
- Added SQL formatter with ipynb, py, and sql file support
- Added f-string support for syntax highlighting

### 0.1.0
- Initial release with basic SQL syntax highlighting

## Known Issues

- Closing braces may not indent correctly in some cases
Please report issues on the [GitHub repository](https://github.com/eluc1a/sql-in-python-highlighter/issues).

## License

MIT