// Viewer 将 Source 中的稳定定义与 Result 中的稀疏执行字段合并；缺失的执行字段补为 null，screenshots 补为空数组。

export const emptyResult = {
  "source_id": "11111111-1111-4111-8111-111111111111",
  "system": null,
  "environment": "UAT",
  "result": null,
  "cases": {}
};

export const partialResult = {
  "source_id": "11111111-1111-4111-8111-111111111111",
  "system": "QC",
  "environment": "UAT",
  "result": null,
  "cases": {
    "22222222-2222-4222-8222-222222222222": {
      "page_id": "qc-login",
      "actual_url": "https://uat.example.test/login",
      "result": null,
      "steps": {
        "1": {
          "actual": "登录成功并进入首页",
          "result": "PASSED",
          "screenshots": [
            "execute-testcase/screenshots/uat_case01_step01_01_result.png"
          ]
        }
      }
    }
  }
};

export const completeResult = {
  "source_id": "11111111-1111-4111-8111-111111111111",
  "system": "QC",
  "environment": "UAT",
  "result": "BLOCKED",
  "cases": {
    "22222222-2222-4222-8222-222222222222": {
      "page_id": "qc-login",
      "actual_url": "https://uat.example.test/login",
      "result": "PASSED",
      "steps": {
        "1": {
          "actual": "登录成功并进入首页",
          "result": "PASSED",
          "screenshots": [
            "execute-testcase/screenshots/uat_case01_step01_01_result.png"
          ]
        },
        "2": {
          "actual": "账号信息显示test_user_01",
          "result": "PASSED",
          "screenshots": [
            "execute-testcase/screenshots/uat_case01_step02_01_result.png"
          ]
        }
      }
    },
    "33333333-3333-4333-8333-333333333333": {
      "page_id": "qc-login",
      "actual_url": "https://uat.example.test/login",
      "result": "BLOCKED",
      "steps": {
        "1": {
          "actual": "测试账号已被其他任务锁定，无法验证按钮状态",
          "result": "BLOCKED",
          "screenshots": [
            "execute-testcase/screenshots/uat_case02_step01_01_blocked.png"
          ]
        }
      }
    }
  }
};

export const mergedViewModel = {
  "source_id": "11111111-1111-4111-8111-111111111111",
  "system": "QC",
  "prd_name": "#84313 用户登录优化",
  "environment": "UAT",
  "result": null,
  "testcases": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "case_name": "#84313-01-正确账号密码登录",
      "module_path": ["用户中心", "账号登录"],
      "precondition": "已创建状态为启用的UAT测试账号test_user_01",
      "page_id": "qc-login",
      "actual_url": "https://uat.example.test/login",
      "result": null,
      "steps": [
        {
          "step": 1,
          "action": "进入登录页面，输入账号test_user_01和正确密码，点击登录",
          "expected": "登录成功并进入首页",
          "actual": "登录成功并进入首页",
          "result": "PASSED",
          "screenshots": [
            "execute-testcase/screenshots/uat_case01_step01_01_result.png"
          ]
        },
        {
          "step": 2,
          "action": "查看首页右上角账号信息",
          "expected": "账号信息显示test_user_01",
          "actual": null,
          "result": null,
          "screenshots": []
        }
      ]
    }
  ]
};
