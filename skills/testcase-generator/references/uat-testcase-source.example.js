window.TESTCASE_SOURCE = {
  "source_id": "11111111-1111-4111-8111-111111111111",
  "environment": "UAT",
  "prd_name": "#84313 用户登录优化",
  "testcases": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "case_name": "#84313-01-正确账号密码登录",
      "module_path": [
        "用户中心",
        "账号登录",
        "密码登录"
      ],
      "precondition": "已在UAT环境创建状态为启用的测试账号test_user_01",
      "steps": [
        {
          "step": 1,
          "action": "进入UAT登录页面，在用户名输入框填写test_user_01，在密码输入框填写Test@123456",
          "expected": "登录按钮变为可点击状态"
        },
        {
          "step": 2,
          "action": "点击登录按钮",
          "expected": "系统登录成功并跳转至UAT首页"
        }
      ]
    },
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "case_name": "#84313-02-密码为空登录",
      "module_path": [
        "用户中心",
        "账号登录",
        "密码登录"
      ],
      "precondition": "",
      "steps": [
        {
          "step": 1,
          "action": "进入UAT登录页面，在用户名输入框填写test_user_01，保持密码输入框为空",
          "expected": "登录按钮保持不可点击状态"
        },
        {
          "step": 2,
          "action": "按Enter键尝试提交登录",
          "expected": "页面停留在UAT登录页且密码输入框显示必填提示"
        }
      ]
    }
  ]
};
