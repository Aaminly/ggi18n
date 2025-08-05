#!/usr/bin/env node

import fs from "node:fs";
import { argv } from "node:process";
import translate from "google-translate-api-x";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";

class Translator {
  constructor() {
    this.ARGUMENTS = argv.slice(2);
    this.spinner = ora();
    this.path = null;
    this.word = null;
    this.commands = [
      { name: "文件翻译", value: "file", show: false },
      { name: "单词翻译", value: "word" },
      { name: "删除词条", value: "delete" },
      { name: "新增语种", value: "new" },
      { name: "检查词条", value: "check", show: false },
      { name: "重命名词条", value: "rename", show: false },
    ];
  }

  getArg(name, config) {
    let target = this.ARGUMENTS.find((arg) => arg.startsWith(name)) ?? null;
    if (target && config?.replace) {
      target = target?.replace?.(name, "");
    }
    return target;
  }

  // 谷歌翻译
  async trans(txt, to, errCallback) {
    const langFix = {
      en_US: "en",
      zh: "zh-CN",
      zh_CN: "zh-CN",
      zh_TW: "zh-TW",
    };
    return await translate(txt, { to: langFix[to] || to })
      .then((res) => res.text[0].toUpperCase() + res.text.substring(1))
      .catch(() => {
        errCallback?.();
      });
  }

  // 批量翻译
  async batchTrans(obj, lang) {
    const result = [];
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        result.push({
          key,
          value: `${value}\n`,
        });
      } else {
        obj[key] = await this.batchTrans(value, lang);
      }
      if (result.length >= 20) {
        await this.transParse(obj, result, lang);
        result.length = 0;
      }
    }

    if (result.length) {
      await this.transParse(obj, result, lang);
    }
    // fix translate error
    if (obj.pre) obj.pre = obj.pre.replace(/<\/ br>|< \/br>/g, "</br>");
    return obj;
  }

  // 翻译转换格式化
  async transParse(obj, result, lang) {
    let transRes = await this.trans(
      result.map((item) => item.value).join(""),
      lang
    );

    transRes = transRes.split("\n");
    result
      .map((item) => item.key)
      .forEach((key, index) => {
        obj[key] = transRes[index];
      });
  }

  // 文件读取
  async readFiles(file, callback, lang) {
    const path = this.getArg("--path=", { replace: true });

    if (!path) {
      throw new Error(`
        请设置需要翻译的文件路径
        run: npx ggi18n path=src/xx ...
        `);
    }

    await fs.readdir(path, async (err, files) => {
      if (!err) {
        const arr = lang ? [lang] : files;
        if (!arr.length) {
          console.error("未找到需要翻译的文件");
        }
        for (const lang of arr) {
          const pathName = `${path}/${lang.replace(".json", "")}.json`;
          const fileStr = fs.readFileSync(pathName).toString();
          const fileObj = JSON.parse(fileStr);
          const result = await callback({
            lang: lang.replace(".json", ""),
            fileObj,
          });

          const { write, msg } =
            typeof result === "boolean" ? { write: result } : result || {};
          if (write) {
            await this.objToFile({
              msg,
              lang: lang.replace(".json", ""),
              pathName,
              fileObj,
            });
          }
        }
      } else {
        console.log(err);
      }
    });
  }

  // 处理完的对象写入文件
  async objToFile({ msg, lang, pathName, fileObj }) {
    const objStr = JSON.stringify(fileObj, null, 2);
    fs.writeFileSync(pathName, objStr);
    this.spinner.succeed(chalk.green(msg || `${lang} 语种字典写入完毕`));
  }

  // args obj层级解构
  argsObjFormat(type) {
    let args = this.getArg(type);

    if (!args) {
      console.error(`请确认输入是否正确`);
      return;
    }

    let file, obj, currObj, key, keyArr, cacheKeyArr, value;
    [args, value] = args.split("=");

    args = value.split(":");

    if (args.length === 1) {
      key = args[0];
      value = key;
      cacheKeyArr = key.split(".");
    } else {
      [key, value] = args;
      keyArr = key.split(".");
      cacheKeyArr = key.split(".");
      if (keyArr.length > 1) {
        obj = {};
        currObj = obj;
        while (keyArr.length) {
          key = keyArr.shift();
          currObj[key] = {};
          currObj = currObj[key];
        }
      }
    }

    return { file, obj, currObj, key, keyArr: cacheKeyArr, value };
  }

  // 文件翻译
  handleFileTranslation() {
    if (!this.ARGUMENTS.includes("f")) return;

    let lang = this.ARGUMENTS.find((arg) => arg.startsWith("lang"));
    if (!lang) {
      console.log("文件翻译模式下必须携带 lang=xx 参数（xx 为翻译语种）");
      return;
    }
    lang = lang.replace("lang=", "");

    let file = this.ARGUMENTS.find((arg) => arg.startsWith("file="));
    if (!file) {
      console.log("文件翻译模式下必须携带 file=xx 参数（xx 为翻译字典文件名）");
      return;
    }
    file = file.replace("file=", "");

    if (lang && file) {
      this.readFiles(
        file,
        async ({ fileObj }) => {
          await this.batchTrans(fileObj, lang);
          return true;
        },
        lang
      );
    }
  }

  // 新增语种
  handleNewLanguage() {
    const newLangArg = this.getArg("--new=", { replace: true });
    if (!newLangArg) return;

    const [oldLang, newLang] = newLangArg.split(":");
    if (!oldLang || !newLang) {
      console.error(`ERROR: 必须同时指定旧语种和新语种
        run: npx ggi18n --new=en:ja
      `);
      return;
    }

    const path = this.getArg("--path=", { replace: true });
    this.spinner.succeed(
      chalk.yellow(`正在基于 ${oldLang} 语种字典翻译成 ${newLang} 语种`)
    );
    fs.cp(
      `${path}/${oldLang}.json`,
      `${path}/${newLang}.json`,
      { recursive: true },
      (err) => {
        if (!err) {
          this.readFiles(
            newLang,
            async ({ fileObj }) => {
              try {
                await this.batchTrans(fileObj, newLang, () => {});
                return {
                  write: true,
                  msg: `${newLang} 语种字典翻译完毕`,
                };
              } catch (error) {
                fs.unlink(`${path}/${newLang}.json`, () => {});
                console.error(
                  `ERROR: 新增 ${newLang} 语种失败，请检查 ${newLang} 是否为google翻译的语种KEY`
                );
              }
            },
            newLang
          );
        }
      }
    );
  }

  // 单词翻译
  async handleWordTranslation() {
    const wordArg = this.getArg("--word=");
    if (!wordArg) return;

    let { file, key, keyArr, value } = this.argsObjFormat("--word");
    const isCover = this.getArg("--cover");

    let result = value;
    const transValue = async (value, lang) => {
      result = await this.trans(value || key, lang);
      return result;
    };

    await this.readFiles(file, async ({ lang, fileObj }) => {
      let write = false;
      const keyStr = keyArr?.join?.(".");
      const keys = keyStr.split(".");
      if (keys) {
        let currObj = fileObj;
        let prevObj = currObj;
        while (keys.length) {
          if (typeof currObj === "string") {
            console.error(
              `ERROR: ${key} 是一个 string 类型，请检查输入是否正确`
            );
            return;
          }

          key = keys.shift();
          if (!currObj[key]) {
            currObj[key] = {};
          }
          prevObj = currObj;
          currObj = currObj[key];
        }

        if (
          typeof prevObj?.[key] !== "string" &&
          !Object.keys(prevObj?.[key] ?? {}).length
        ) {
          prevObj[key] = "";
        }

        if (!prevObj[key] || isCover) {
          write = true;
          prevObj[key] = await transValue(result, lang);
        }
      } else {
        if (!fileObj[key] || isCover) {
          write = true;
          fileObj[key] = await transValue(result, lang);
        }
      }
      if (write) {
        return write;
      }
      console.error(
        `ERROR: ${lang} 语种 ${keyStr} 已存在。如要覆盖，请追加 --cover 关键字`
      );
    });
  }

  // 替换词条
  handleReplaceEntry() {
    const replaceArg = this.getArg("--replace=");
    if (!replaceArg) return;
  }

  // 删除词条
  handleDeleteEntry() {
    const deleteArg = this.getArg("--delete=");
    if (!deleteArg) return;

    let { key, keyArr } = this.argsObjFormat("--delete");

    this.readFiles(null, ({ lang, fileObj }) => {
      let deleted = false;

      const deleteNestedKey = (obj, keys) => {
        if (keys.length === 1) {
          if (obj.hasOwnProperty(keys[0])) {
            delete obj[keys[0]];
            return true;
          }
          return false;
        }

        const currentKey = keys[0];
        if (
          obj.hasOwnProperty(currentKey) &&
          typeof obj[currentKey] === "object"
        ) {
          return deleteNestedKey(obj[currentKey], keys.slice(1));
        }
        return false;
      };

      if (keyArr) {
        deleted = deleteNestedKey(fileObj, keyArr);
      } else if (fileObj.hasOwnProperty(key)) {
        delete fileObj[key];
        deleted = true;
        keyArr = [key];
      }

      if (!deleted) {
        console.error(
          `ERROR: ${lang} 语种文件里未找到 ${keyArr ? keyArr.join(".") : key}`
        );
        return;
      }

      return {
        write: true,
        msg: `${lang} 语种 ${keyArr.join(".")} 已删除`,
      };
    });
  }

  // 检测词条是否存在
  handleCheckEntry() {
    if (!this.ARGUMENTS.includes("has")) return;

    const { file, obj, key } = this.argsObjFormat("has");
    this.readFiles(file, ({ lang, fileObj }) => {
      let has = false;
      if (obj && fileObj[obj]) {
        if (key && fileObj[obj][key]) {
          has = true;
        }
      } else if (key && fileObj[key]) {
        has = true;
      }
      console.log(
        `${lang} 语种文件 ${has ? "----已找到----" : "未找到"} ${file}${
          obj ? `.${obj}` : ""
        }.${key}`
      );
    });
  }

  // 重命名词条key
  handleRenameEntry() {
    if (!this.ARGUMENTS.includes("rename")) return;

    let { file, obj, key } = this.argsObjFormat("rename");
    let rename;
    [key, rename] = key.split(" ");
    if (!rename) {
      console.log("未找到重命名名称");
      return;
    }

    this.readFiles(file, async ({ lang, fileObj }) => {
      let has = false;
      if (obj && fileObj[obj]) {
        if (key && fileObj[obj][key]) {
          has = true;
          fileObj[obj][rename] = fileObj[obj][key];
          delete fileObj[obj][key];
        }
      } else if (key && fileObj[key]) {
        has = true;
        fileObj[rename] = fileObj[key];
        delete fileObj[key];
      }
      if (!has) {
        console.log(
          `${lang} 语种文件里未找到 ${file}${obj ? `.${obj}` : ""}.${key}`
        );
        return;
      }
      return {
        write: true,
        msg: `${lang} 语种 ${file}${
          obj ? `.${obj}` : ""
        }.${key} 已重命名为 ${file}${obj ? `.${obj}` : ""}.${rename}`,
      };
    });
  }

  // 显示主菜单
  async showMainMenu() {
    // 检查是否有缓存的路径
    this.path = this.getArg("--path=", { replace: true });
    this.word = this.getArg("--word=", { replace: true });

    const { command } = await inquirer.prompt([
      {
        type: "list",
        name: "command",
        message: chalk.cyan("请选择要执行的操作："),
        choices: this.commands.filter((item) => item.show ?? true),
      },
    ]);

    switch (command) {
      case "file":
        await this.showFileTranslationMenu();
        break;
      case "new":
        await this.showNewLanguageMenu();
        break;
      case "word":
        await this.showWordTranslationMenu();
        break;
      case "delete":
        await this.showDeleteEntryMenu();
        break;
      case "check":
        await this.showCheckEntryMenu();
        break;
      case "rename":
        await this.showRenameEntryMenu();
        break;
    }
  }

  async createAnswers(answers) {
    if (this.word) {
      answers = answers.filter((item) => item.name !== "word");
      this.spinner.succeed(chalk.green(`翻译：${this.word}`));
    }
    return await inquirer.prompt([
      ...(this.path
        ? []
        : [
            {
              type: "input",
              name: "path",
              message: chalk.cyan("请输入翻译文件路径："),
              validate: (input) => !!input || "路径不能为空",
            },
          ]),
      ...answers,
    ]);
  }

  // 文件翻译菜单
  async showFileTranslationMenu() {
    const answers = await this.createAnswers([
      {
        type: "input",
        name: "lang",
        message: chalk.cyan("请输入目标语言："),
        validate: (input) => !!input || "语言不能为空",
      },
      {
        type: "input",
        name: "file",
        message: chalk.cyan("请输入翻译字典文件名："),
        validate: (input) => !!input || "文件名不能为空",
      },
    ]);

    this.ARGUMENTS = [
      "f",
      `lang=${answers.lang}`,
      `file=${answers.file}`,
      `--path=${answers.path}`,
    ];
    this.spinner.start(chalk.yellow("正在翻译文件..."));
    await this.handleFileTranslation();
    this.spinner.succeed(chalk.green("翻译完成！"));
  }

  // 新增语种菜单
  async showNewLanguageMenu() {
    const answers = await this.createAnswers([
      {
        type: "input",
        name: "oldLang",
        message: chalk.cyan("请输入源语言："),
        validate: (input) => !!input || "语言不能为空",
      },
      {
        type: "input",
        name: "newLang",
        message: chalk.cyan("请输入目标语言："),
        validate: (input) => !!input || "语言不能为空",
      },
    ]);

    this.ARGUMENTS = [
      `--new=${answers.oldLang}:${answers.newLang}`,
      `--path=${answers.path}`,
    ];
    this.pathCache = answers.path;
    this.spinner.start(chalk.yellow("正在新增语种..."));
    await this.handleNewLanguage();
    this.spinner.succeed(chalk.green("新增语种完成！"));
  }

  // 单词翻译菜单
  async showWordTranslationMenu() {
    const answers = await this.createAnswers([
      {
        type: "input",
        name: "word",
        message: chalk.cyan("请输入要翻译的词条："),
        validate: (input) => !!input || "词条不能为空",
      },
      {
        type: "confirm",
        name: "cover",
        message: chalk.cyan("是否覆盖已存在的词条？"),
        default: false,
      },
    ]);

    this.ARGUMENTS = [
      `--word=${answers.word}`,
      `--path=${this.path || answers.path}`,
    ];
    if (answers.cover) this.ARGUMENTS.push("--cover");
    this.pathCache = answers.path;
    this.spinner.start(chalk.yellow("正在翻译词条..."));
    this.handleWordTranslation();
  }

  // 删除词条菜单
  async showDeleteEntryMenu() {
    const answers = await this.createAnswers([
      {
        type: "input",
        name: "key",
        message: chalk.cyan("请输入要删除的词条："),
        validate: (input) => !!input || "词条不能为空",
      },
    ]);

    this.ARGUMENTS = [`--delete=${answers.key}`, `--path=${answers.path}`];
    this.pathCache = answers.path;
    this.spinner.start(chalk.yellow("正在删除词条..."));
    await this.handleDeleteEntry();
    this.spinner.succeed(chalk.green("词条删除完成！"));
  }

  // 检查词条菜单
  async showCheckEntryMenu() {
    const answers = await this.createAnswers([
      {
        type: "input",
        name: "key",
        message: chalk.cyan("请输入要检查的词条："),
        validate: (input) => !!input || "词条不能为空",
      },
    ]);

    this.ARGUMENTS = ["has", `has=${answers.key}`, `--path=${answers.path}`];
    this.pathCache = answers.path;
    this.spinner.start(chalk.yellow("正在检查词条..."));
    await this.handleCheckEntry();
    this.spinner.succeed(chalk.green("词条检查完成！"));
  }

  // 重命名词条菜单
  async showRenameEntryMenu() {
    const answers = await this.createAnswers([
      {
        type: "input",
        name: "oldKey",
        message: chalk.cyan("请输入要重命名的词条："),
        validate: (input) => !!input || "词条不能为空",
      },
      {
        type: "input",
        name: "newKey",
        message: chalk.cyan("请输入新的词条名："),
        validate: (input) => !!input || "词条名不能为空",
      },
    ]);

    this.ARGUMENTS = [
      "rename",
      `rename=${answers.oldKey} ${answers.newKey}`,
      `--path=${answers.path}`,
    ];
    this.pathCache = answers.path;
    this.spinner.start(chalk.yellow("正在重命名词条..."));
    await this.handleRenameEntry();
    this.spinner.succeed(chalk.green("词条重命名完成！"));
  }

  // 执行所有操作
  async run() {
    console.log(chalk.bold.blue("欢迎使用 ggi18n 多语言翻译工具！"));
    await this.showMainMenu();
  }
}

// 创建实例并运行
const translator = new Translator();
translator.run();
