WITH original AS (
    SELECT
        prospect_id,
        inquiry_id,
        program_group_code,
        CASE 
            WHEN (campaign_name LIKE '%Google_Brand%' OR campaign_name LIKE '%Microsoft_Brand%') 
                AND MARKETING_GROUPING IN ('Paid Search', 'UK Paid Search') then 'Brand'
            WHEN (campaign_name LIKE '%NB%' OR campaign_name LIKE '%Non%' OR campaign_name LIKE '%non%' OR campaign_name LIKE '%Non Brand%')
                AND MARKETING_GROUPING IN ('Paid Search', 'UK Paid Search') then 'NB'
            WHEN (campaign_name LIKE '%BR%' OR campaign_name LIKE '%Brand%') 
                AND MARKETING_GROUPING IN ('Paid Search', 'UK Paid Search') then 'Brand'
            WHEN MARKETING_GROUPING IN ('Paid Search', 'UK Paid Search') then 'NB'
            WHEN MARKETING_GROUPING='Event' 
                AND CAMPAIGN_NAME NOT IN ('RSVP Page  _OPH_NA_Event' ,'1202_OPH_NA_EVT_ATTEND') then 'CU WFS'
            WHEN MARKETING_GROUPING='Event'
                AND CAMPAIGN_NAME IN ('RSVP Page  _OPH_NA_Event' ,'1202_OPH_NA_EVT_ATTEND') then 'CU Event'
            ELSE MARKETING_GROUPING
        END AS marketing_grouping,
        location_name,
        enrolldsi,
        CASE
            WHEN CAST(academic_period AS INTEGER) >= 202540 THEN NULL
            ELSE academic_period
        END AS academic_period,
        CASE
            WHEN enrolldsi IS NOT NULL AND academic_period IS NOT NULL THEN 1
            WHEN enrolldsi IS NOT NULL AND CAST(academic_period AS INTEGER) >= 202540  THEN 0
            ELSE 0
        END AS enrollment,
        1 AS inquiry,
        inquiry_created_date AS inquiry_date
    FROM
        daas-cdw-prod.rpt_crm_mart.v_cu_kpi_cohorted_view
    WHERE
        inquiry_created_date >= '1997-01-01'
        AND inquiry_created_date < '2025-07-01'
    ),

new_enr_filter AS (
    SELECT
        dsi,
        credited_raw_inquiry_c,
        CASE
            WHEN CAST(academic_period AS INTEGER) >= 202540 THEN NULL
            ELSE academic_period
        END AS academic_period,
        CASE
            WHEN dsi IS NOT NULL AND academic_period IS NOT NULL THEN 1
            WHEN dsi IS NOT NULL AND CAST(academic_period AS INTEGER) >= 202540  THEN 0
            ELSE 0
        END AS enrollment,
        inquiry_date,
        program_code as program_code_enr,
        program_group as program_group_enr,
        location_name as location_name_enr,
        marketing_grouping_c as marketing_grouping_enr
    FROM
        daas-cdw-prod.rpt_semantic.cu_enrollment_list
),

final_with_inq AS (
    SELECT DISTINCT
        original.prospect_id,
        original.inquiry_id,
        -- original.program_group_code as program_group_code, -- program from inquiry
        COALESCE(new_enr_filter.program_group_enr, original.program_group_code) as program_group_code, -- program from enrollment
        original.marketing_grouping,
        -- original.location_name, -- location from inquiry
        COALESCE(new_enr_filter.location_name_enr, original.location_name) as location_name, -- location from enrollment
        original.enrolldsi,
        original.inquiry,
        original.inquiry_date,
        new_enr_filter.academic_period,
        new_enr_filter.enrollment,
    FROM original
    LEFT JOIN new_enr_filter
        ON original.enrolldsi = new_enr_filter.dsi
        AND original.inquiry_id = new_enr_filter.credited_raw_inquiry_c
),

unique_dsi_in_inq AS (
    SELECT DISTINCT
            enrolldsi,
            academic_period
        FROM 
            final_with_inq
),

unique_dsi_in_enr AS (
    SELECT 
        dsi,
        credited_raw_inquiry_c,
        CASE
            WHEN CAST(academic_period AS INTEGER) >= 202540 THEN NULL
            ELSE academic_period
        END AS academic_period,
        CASE
            WHEN dsi IS NOT NULL AND academic_period IS NOT NULL THEN 1
            WHEN dsi IS NOT NULL AND CAST(academic_period AS INTEGER) >= 202540  THEN 0
            ELSE 0
        END AS enrollment,
        inquiry_date,
        program_code as program_code_enr,
        program_group as program_group_enr,
        location_name as location_name_enr,
        marketing_grouping_c as marketing_grouping_enr
    FROM daas-cdw-prod.rpt_semantic.cu_enrollment_list culist
    WHERE NOT EXISTS (
        SELECT 1
        FROM
            unique_dsi_in_inq
        WHERE 
            culist.dsi = unique_dsi_in_inq.enrolldsi
        AND culist.academic_period = unique_dsi_in_inq.academic_period
    )
),

unique_dsi_in_enr_with_columns AS (
    SELECT
        'NULL' AS prospect_id,
        credited_raw_inquiry_c AS inquiry_id,
        program_group_enr AS program_group_code,
        marketing_grouping_enr AS marketing_grouping,
        location_name_enr AS location_name,
        dsi AS enrolldsi,
        1 as inquiry,
        COALESCE(inquiry_date, '2009-01-01') AS inquiry_date,
        academic_period AS academic_period,
        1 AS enrollment,
    FROM unique_dsi_in_enr
),

old_enrolls AS (
    SELECT
        prospect_id,
        inquiry_id,
        program_group_code,
        -- marketing_grouping,
        CASE 
            WHEN marketing_grouping = 'Affiliates' THEN 'Aggregators'
            WHEN marketing_grouping = 'Event' AND program_group_code = 'BSN' THEN 'WFS'
            WHEN marketing_grouping = 'KCCL Partner Page' THEN 'Others'
            WHEN marketing_grouping = 'Other Channels' THEN 'Others'
            WHEN marketing_grouping = 'Other Marketing' THEN 'Others'
            WHEN marketing_grouping = 'Paid Search' THEN 'Search Generic'
            WHEN marketing_grouping = 'PD' THEN 'Others'
            WHEN marketing_grouping = '' THEN 'Others'
            WHEN marketing_grouping IS NULL THEN 'Others'
            ELSE marketing_grouping
        END AS marketing_grouping,
        location_name,
        enrolldsi,
        inquiry,
        inquiry_date,
        CAST(academic_period AS INTEGER) as academic_period,
        enrollment
    FROM
        original
    WHERE
        CAST(academic_period AS INTEGER) < 202040
),

final AS (
SELECT * FROM final_with_inq
UNION ALL
SELECT * FROM unique_dsi_in_enr_with_columns
UNION ALL
SELECT * FROM old_enrolls
)

SELECT
    prospect_id,
    inquiry_id,
    program_group_code,
    -- marketing_grouping,
    CASE 
        WHEN marketing_grouping = 'Affiliates' THEN 'Aggregators'
        WHEN marketing_grouping = 'Event' AND program_group_code = 'BSN' THEN 'WFS'
        WHEN marketing_grouping = 'KCCL Partner Page' THEN 'Others'
        WHEN marketing_grouping = 'Other Channels' THEN 'Others'
        WHEN marketing_grouping = 'Other Marketing' THEN 'Others'
        WHEN marketing_grouping = 'Paid Search' THEN 'Search Generic'
        WHEN marketing_grouping = 'PD' THEN 'Others'
        WHEN marketing_grouping = '' THEN 'Others'
        WHEN marketing_grouping IS NULL THEN 'Others'
        ELSE marketing_grouping
    END AS marketing_grouping,
    location_name,
    enrolldsi,
    inquiry,
    inquiry_date,
    CAST(academic_period AS INTEGER) as academic_period,
    enrollment
FROM final 
-- LIMIT 10000
