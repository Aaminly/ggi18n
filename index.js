#!/usr/bin/env node

import fs from "node:fs";
import { argv } from "node:process";
import translate from "@iamtraction/google-translate";

const ARGUMENTS = argv.slice(2);

const getArg = (name, config) => {
  let target = ARGUMENTS.find((arg) => arg.startsWith(name)) ?? null;
  if (target && config?.replace) {
    target = target?.replace?.(name, "");
  }
  return target;
};

const path = getArg("--path=", { replace: true });

if (!path) {
  throw new Error(`
		请设置需要翻译的文件路径
		run: npx ggi18n path=src/xx ...
		`);
}

// 谷歌翻译
async function trans(txt, to, errCallback) {
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
async function batchTrans(obj, lang) {
  const result = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result.push({
        key,
        value: `${value}\n`,
      });
    } else {
      obj[key] = await batchTrans(value, lang);
    }
    if (result.length >= 20) {
      await transParse(obj, result, lang);
      result.length = 0;
    }
  }

  if (result.length) {
    await transParse(obj, result, lang);
  }
  // fix translate error
  if (obj.pre) obj.pre = obj.pre.replace(/<\/ br>|< \/br>/g, "</br>");
  return obj;
}

// 翻译转换格式化
async function transParse(obj, result, lang) {
  let transRes = await trans(result.map((item) => item.value).join(""), lang);

  transRes = transRes.split("\n");
  result
    .map((item) => item.key)
    .forEach((key, index) => {
      obj[key] = transRes[index];
    });
}

// 文件读取
function readFiles(file, callback, lang) {
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
          objToFile({
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
function objToFile({ msg, lang, pathName, fileObj }) {
  const objStr = JSON.stringify(fileObj, null, 2);
  // objStr = objStr.replace(/\\"/g, "\uFFFF");  // U+ FFFF
  // objStr = objStr.replace(/"([^"]+)":/g, '$1:').replace(/\uFFFF/g, '\\\"');
  fs.writeFileSync(pathName, objStr);
  console.log(msg || `${lang} 语种字典写入完毕`);
}

// args obj层级解构
function argsObjFormat(type) {
  let args = getArg(type);

  if (!args) {
    console.error(`请确认输入是否正确`);
    return;
  }

  // biome-ignore lint/style/useSingleVarDeclarator: <explanation>
  let file, obj, currObj, key, keyArr, cacheKeyArr, value;
  [args, value] = args.split("=");

  args = value.split(":");

  if (args.length === 1) {
    key = args[0];
    value = key;
  } else {
    [key, value] = args;
    keyArr = key.split(".");
    cacheKeyArr = JSON.parse(JSON.stringify(keyArr));
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
if (ARGUMENTS.includes("f")) {
  let lang = ARGUMENTS.find((arg) => arg.startsWith("lang"));
  if (!lang) {
    console.log("文件翻译模式下必须携带 lang=xx 参数（xx 为翻译语种）");
  } else {
    lang = lang.replace("lang=", "");
  }
  let file = ARGUMENTS.find((arg) => arg.startsWith("file="));
  if (!file) {
    console.log("文件翻译模式下必须携带 file=xx 参数（xx 为翻译字典文件名）");
  } else {
    file = file.replace("file=", "");
  }

  if (lang && file) {
    readFiles(
      file,
      async ({ fileObj }) => {
        await batchTrans(fileObj, lang);
        return true;
      },
      lang
    );
  }
}

// 新增语种
if (getArg("--new")) {
  let lang = getArg("--new=", { replace: true });

  const [oldLang, newLang] = lang.split(":");
  if (!oldLang || !newLang) {
    console.error(`ERROR: 必须同时指定旧语种和新语种
				run: npx ggi18n --new=en:ja
			`);
  } else {
    console.log(`正在基于 ${oldLang} 语种字典翻译成 ${newLang} 语种`);
    fs.cp(
      `${path}/${oldLang}.json`,
      `${path}/${newLang}.json`,
      { recursive: true },
      (err) => {
        if (!err) {
          readFiles(
            newLang,
            async ({ fileObj }) => {
              try {
                await batchTrans(fileObj, newLang, () => {});
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
}

// 单词翻译
if (getArg("--word=")) {
  let { file, key, keyArr, value } = argsObjFormat("--word");
  const isCover = getArg("--cover");

  let result = value;
  // if (!value) {
  // 	console.log("未指定翻译基准内容，请确认输入是否正确");
  // } else {
  const transValue = async (value, lang) => {
    result = await trans(value || key, lang);
    return result;
  };
  // (value = lang === "zh_CN" ? value : await trans(value, lang));
  readFiles(file, async ({ lang, fileObj }) => {
    let write = false;
    const keyStr = keyArr?.join?.(".");
    if (keyArr) {
      let currObj = fileObj;
      let prevObj = currObj;
      while (keyArr.length) {
        if (typeof currObj === "string") {
          console.error(`ERROR: ${key} 是一个 string 类型，请检查输入是否正确`);
          return;
        }
        key = keyArr.shift();
        if (!currObj[key]) {
          currObj[key] = {};
        }
        prevObj = currObj;
        currObj = currObj[key];
      }

      if (
        typeof prevObj?.[key] !== "string" &&
        !Object.keys(prevObj?.[key]).length
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
  // }
}

// 删除词条
if (ARGUMENTS.includes("d")) {
  const { file, obj, key } = argsObjFormat("d");
  readFiles(file, ({ lang, fileObj }) => {
    let deleted = false;
    if (obj && fileObj[obj]) {
      if (key && fileObj[obj][key]) {
        deleted = true;
        delete fileObj[obj][key];
      }
    } else if (key && fileObj[key]) {
      deleted = true;
      delete fileObj[key];
    }
    if (!deleted) {
      console.log(
        `${lang} 语种文件里未找到 ${file}${obj ? `.${obj}` : ""}.${key}`
      );
      return;
    }
    return {
      write: true,
      msg: `${lang} 语种 ${file}${obj ? `.${obj}` : ""}.${key} 已删除`,
    };
  });
}

// 检测词条是否存在
if (ARGUMENTS.includes("has")) {
  const { file, obj, key } = argsObjFormat("has");
  readFiles(file, ({ lang, fileObj }) => {
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

// 重命名词条key，只支持同文件，同结构下改最后一级名称
if (ARGUMENTS.includes("rename")) {
  let { file, obj, key } = argsObjFormat("rename");
  // biome-ignore lint/style/useConst: <explanation>
  let rename;
  [key, rename] = key.split(" ");
  if (!rename) {
    console.log("未找到重命名名称");
  } else {
    readFiles(file, async ({ lang, fileObj }) => {
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
}
