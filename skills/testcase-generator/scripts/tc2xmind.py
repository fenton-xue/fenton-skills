#!/usr/bin/env python3
"""
将测试用例 Markdown 文件转换为 XMind 可导入的 Markdown 格式

用法:
    python tc2xmind.py <input.md> [output.md]

示例:
    python tc2xmind.py testcases.md
    python tc2xmind.py testcases.md xmind_testcases.md
"""

import sys
import os
import re
from pathlib import Path


def parse_testcases(content: str) -> list[dict]:
    testcases = []
    current_case = None
    current_field = None
    current_content = []
    
    def normalize_xmind_text(lines: list[str]) -> str:
        normalized = []
        for line in lines:
            normalized.append(re.sub(r'^(\d+)\.\s+', r'\1.', line))
        return '<br>'.join(normalized)

    def save_content():
        if current_case and current_field and current_content:
            field_type, idx = current_field
            text = normalize_xmind_text(current_content)
            if field_type == 'step':
                while len(current_case['steps']) < idx:
                    current_case['steps'].append('')
                current_case['steps'][idx - 1] = text
            elif field_type == 'expected':
                while len(current_case['expected']) < idx:
                    current_case['expected'].append('')
                current_case['expected'][idx - 1] = text
    
    lines = content.split('\n')
    
    for line in lines:
        stripped = line.strip().lstrip('\ufeff')
        
        if stripped.startswith('一级模块:'):
            save_content()
            current_field = None
            current_content = []
            if current_case:
                testcases.append(current_case)
            module_name = stripped.split(':', 1)[1].strip()
            current_case = {'modules': [module_name], 'name': '', 'steps': [], 'expected': []}
        elif stripped.startswith('二级模块:') and current_case:
            save_content()
            current_field = None
            current_content = []
            current_case['modules'].append(stripped.split(':', 1)[1].strip())
        elif re.match(r'^[三四五六七八九十]+级模块:', stripped) and current_case:
            save_content()
            current_field = None
            current_content = []
            current_case['modules'].append(stripped.split(':', 1)[1].strip())
        elif stripped.startswith('用例名称:') and current_case:
            save_content()
            current_field = None
            current_content = []
            current_case['name'] = stripped.split(':', 1)[1].strip()
        elif re.match(r'^步骤描述(\d+):', stripped):
            save_content()
            match = re.match(r'^步骤描述(\d+):(.*)$', stripped)
            if match and current_case:
                idx = int(match.group(1))
                first_line = match.group(2).strip()
                current_field = ('step', idx)
                current_content = [first_line] if first_line else []
        elif re.match(r'^预期结果(\d+):', stripped):
            save_content()
            match = re.match(r'^预期结果(\d+):(.*)$', stripped)
            if match and current_case:
                idx = int(match.group(1))
                first_line = match.group(2).strip()
                current_field = ('expected', idx)
                current_content = [first_line] if first_line else []
        elif current_field and stripped:
            current_content.append(stripped)
    
    save_content()
    if current_case:
        testcases.append(current_case)
    
    return testcases


def get_prefix(level: int) -> str:
    return '    ' * (level - 1) + '- '


def normalize_case_name(case_name: str) -> str:
    name = case_name.strip()
    if not name or re.match(r'^cs(?=#)', name, re.IGNORECASE):
        return name
    return f'cs{name}'


def convert_to_xmind_format(testcases: list[dict], root_name: str) -> str:
    lines = []
    
    lines.append(f'{get_prefix(1)}{root_name}')
    lines.append('')
    
    last_modules = []
    
    for case in testcases:
        modules = case.get('modules', [])
        case_name = normalize_case_name(case.get('name', ''))
        steps = case.get('steps', [])
        expected = case.get('expected', [])
        
        for i, module_name in enumerate(modules):
            if i >= len(last_modules) or last_modules[i] != module_name:
                level = i + 2
                lines.append(f'{get_prefix(level)}{module_name}')
                last_modules = last_modules[:i] + [module_name]
        
        case_level = len(modules) + 2
        lines.append(f'{get_prefix(case_level)}{case_name}')
        
        step_level = case_level + 1
        expected_level = step_level + 1
        
        max_count = max(len(steps), len(expected))
        for i in range(max_count):
            if i < len(steps) and steps[i]:
                lines.append(f'{get_prefix(step_level)}{steps[i]}')
            if i < len(expected) and expected[i]:
                lines.append(f'{get_prefix(expected_level)}{expected[i]}')
    
    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    input_path = sys.argv[1]
    
    if not os.path.exists(input_path):
        print(f'错误: 文件不存在 - {input_path}')
        sys.exit(1)
    
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        stem = Path(input_path).stem
        parent = Path(input_path).parent
        output_path = parent / f'xmind_{stem}.md'
    
    root_name = Path(input_path).stem
    
    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    testcases = parse_testcases(content)
    
    if not testcases:
        print('警告: 未解析到任何测试用例')
        sys.exit(0)
    
    print(f'解析到 {len(testcases)} 个测试用例')
    
    result = convert_to_xmind_format(testcases, root_name)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(result)
    
    print(f'XMind 可导入文件已生成: {output_path}')


if __name__ == '__main__':
    main()
