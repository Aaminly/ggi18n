# ggi18n

一个基于Google翻译的多语言翻译工具，可以帮助你快速实现项目的国际化。

## 特性

- 🚀 支持批量翻译JSON语言包
- 🔄 支持基于已有语言包快速创建新语种
- 📝 支持单个翻译文本的快速更新
- 🎯 支持多层级JSON结构的翻译
- 🌐 支持所有Google翻译支持的语种

## 安装使用

```bash
npm install -g @aaminly/ggi18n
# 或者
yarn add -g @aaminly/ggi18n
# 或者
pnpm add -g @aaminly/ggi18n
# 或者 (推荐)
npx ggi18n ...
```

## 使用方法

### 1. 翻译文案

将已有的语言包翻译成新的语种：

```bash
npx ggi18n --path=src/lang --word=hello
```

参数说明：
- `--path`: 语言包所在目录
- `--word=hello`: 指定是文案翻译,hello为翻译的文案，未制定key=value的value时，hello即为key也为值
- `--word=a.b.c=hello`: 多层级翻译支持，如果指定了多层级需要有对应的value值

### 2. 创建新语种

基于已有语种快速创建新的语言包：

```bash
npx ggi18n --path=src/lang --new=en:ja
```

参数说明：
- `--new`: 指定源语种和目标语种，格式为`源语种:目标语种`


## 支持的语言代码

支持所有Google翻译支持的语种，常用语种代码示例：

| 语言 | 代码 |
|------|------|
| 简体中文 | zh-CN |
| 繁体中文 | zh-TW |
| 英语 | en |
| 日语 | ja |
| 韩语 | ko |

更多语种请移步 [Google翻译](https://translate.google.com/) 选择对应的目标语言在URL地址栏查看获取

## 注意事项

1. 确保项目目录下有正确的语言包目录JSON结构
2. 翻译前请确保源语言文件格式正确
3. 建议先使用小型文件测试翻译效果
4. 翻译结果会自动保存到目标语言文件中

## 许可证

ISC License