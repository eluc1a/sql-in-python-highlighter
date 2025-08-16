"""Demo of SQL formatting in Python"""

query = """--sql
WITH users AS (
    SELECT
        user_id,
        CASE
            WHEN status = 'active' THEN 'Active User'
            WHEN status = 'pending' THEN 'Pending Approval'
            ELSE 'Inactive'
        END AS status_label
    FROM
        `project-id-with-dashes.dataset.users`
    WHERE 1 = 1
        AND created_date >= '2024-01-01'
),

orders AS (
    SELECT
        order_id,
        user_id,
        amount
    FROM
        `project-id-with-dashes.dataset.orders`
)

SELECT
    u.user_id,
    u.status_label,
    COUNT(o.order_id) AS order_count,
    SUM(o.amount) AS total_amount
FROM
    users u
    LEFT JOIN orders o ON u.user_id = o.user_id
GROUP BY
    u.user_id,
    u.status_label
"""

print("SQL query formatted successfully!")