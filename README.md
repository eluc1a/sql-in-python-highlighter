# SQL in Python Highlighter

This VS Code extension provides syntax highlighting for SQL code in Python triple-quoted strings when they are marked with `--sql`.

## Usage

Add `--sql` to the beginning of your SQL block:

```python
query = """--sql
SELECT *
FROM users
WHERE id = 123
"""
