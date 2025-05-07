#!/usr/bin/env node

import fs from "node:fs";
import { argv } from "node:process";
import { GoogleTranslator } from "@translate-tools/core/translators/GoogleTranslator/index.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const Trans = new GoogleTranslator({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36",
  },
});

class Translator {
  constructor() {
    this.ARGUMENTS = argv.slice(2);
    if (this.ARGUMENTS.includes("-v")) {
      console.log(`ggi18n version: ${pkg.version}`);
      process.exit(0);
    }
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
    return await Trans.translate(txt, "auto", langFix[to] || to)
      .then((res) => res[0].toUpperCase() + res.substring(1))
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
  readFiles(file, callback, lang) {
    const path = this.getArg("--path=", { replace: true });

    if (!path) {
      throw new Error(`
        请设置需要翻译的文件路径
        run: npx ggi18n path=src/xx ...
        `);
    }

    fs.readdir(path, async (err, files) => {
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
            this.objToFile({
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
  objToFile({ msg, lang, pathName, fileObj }) {
    try {
      const path = require("path");
      const normalizedPath = path.normalize(pathName);
      const objStr = JSON.stringify(fileObj, null, 2);
      fs.writeFileSync(normalizedPath, objStr);
      console.log(msg || `${lang} 语种字典写入完毕`);
    } catch (error) {
      console.error("写入文件失败", error);
    }
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
    console.log(`正在基于 ${oldLang} 语种字典翻译成 ${newLang} 语种`);
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
  handleWordTranslation() {
    const wordArg = this.getArg("--word=");
    if (!wordArg) return;

    let { file, key, keyArr, value } = this.argsObjFormat("--word");
    const isCover = this.getArg("--cover");

    let result = value;
    const transValue = async (value, lang) => {
      result = await this.trans(value || key, lang);
      console.log(`${lang} 语种 ${key} 翻译结果：`, result);

      return result;
    };

    this.readFiles(file, async ({ lang, fileObj }) => {
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

  // 执行所有操作
  run() {
    this.handleFileTranslation();
    this.handleNewLanguage();
    this.handleWordTranslation();
    this.handleDeleteEntry();
    this.handleCheckEntry();
    this.handleRenameEntry();
  }
}

// 创建实例并运行
const translator = new Translator();
translator.run();
