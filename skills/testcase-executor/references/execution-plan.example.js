window.TESTCASE_RESULT = {
  "system": "QC",
  "prd_name": "ZJXT-126499 【线上bug】QC报告审核明细页面",
  "environment": "UAT",
  "result": null,
  "testcases": [
    {
      "case_name": "ZJXT-126499-01-组合货号关联多个子货号",
      "module_path": [
        "QC报告审核",
        "审核明细",
        "组合货号查询-结果准确性"
      ],
      "page_id": "qc-report-review",
      "actual_url": null,
      "result": null,
      "precondition": null,
      "steps": [
        {
          "step": 1,
          "action": "在组合货号查询框输入“CBSKUTEST003”，点击“查询”按钮",
          "expected": "查询结果总数为22条",
          "actual": null,
          "result": null,
          "screenshots": []
        }
      ]
    }
  ]
};
