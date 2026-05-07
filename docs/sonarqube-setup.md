# SonarQube 设置指南

## 概述

XGate 已集成 SonarQube Cloud（SAST + SCA），在 PR/push 时自动扫描安全漏洞和依赖风险。

## 快速开始

### 1. 创建 SonarQube Cloud 项目

1. 访问 [SonarCloud](https://sonarcloud.io/)
2. 使用 GitHub 账号登录
3. 点击 **+** → **Analyze new project**
4. 选择 `boyingliu01/xgate`
5. 选择 **Free plan**（2.5k LOC 免费）

### 2. 配置 GitHub Secrets

在仓库 Settings → Secrets and variables → Actions 中添加：

| Secret | Value |
|--------|-------|
| `SONAR_TOKEN` | SonarCloud 生成的 Token |
| `SONAR_HOST_URL` | `https://sonarcloud.io` |

获取 Token：
1. SonarCloud → My Account → Security
2. 生成 **Token**（选择 `Analyze` scope）
3. 复制到 GitHub Secrets

### 3. 验证集成

创建任意 PR，GitHub Actions 会自动触发 sonarqube workflow：

```bash
git checkout -b test/sonar
echo "# test" >> README.md
git add .
git commit -m "test: verify sonarqube integration"
git push origin test/sonar
```

在 PR 页面查看 **SonarQube Cloud** 检查。

## Quality Gate 配置

SonarCloud 默认 Quality Gate（推荐）：

| 条件 | 阈值 |
|------|------|
| 新代码安全评级 | A |
| 新漏洞 | 0 |
| 新安全热点 | 已审查 |
| 新代码覆盖率 | ≥ 80% |
| 重复代码 | ≤ 3% |

自定义：SonarCloud → Project Settings → Quality Gate

## 本地运行 Sonar Scanner（可选）

```bash
# 安装 sonar-scanner
brew install sonar-scanner

# 运行扫描
sonar-scanner \
  -Dsonar.projectKey=xgate \
  -Dsonar.sources=src/ \
  -Dsonar.host.url=https://sonarcloud.io \
  -Dsonar.token=$SONAR_TOKEN
```

## SARIF 集成

扫描结果通过 SARIF 格式上传到 GitHub Security tab：

```yaml
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: sonar-report.sarif
```

在 PR 的 **Security** tab 查看告警详情。

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| `SONAR_TOKEN` 缺失 | 检查 GitHub Secrets 配置 |
| 项目未找到 | 确认 SonarCloud 中项目 key 为 `xgate` |
| 覆盖率未显示 | 确保 vitest 生成 `coverage/lcov.info` |
| Quality Gate 失败 | 查看 SonarCloud 具体 issue 并修复 |
