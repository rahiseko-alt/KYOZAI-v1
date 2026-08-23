import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [".next*/**", "node_modules/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // 行数上限は既定では無効なので明示的に入れる（AGENTS.md「結合を増やさない」の最終段）。
    // 鳴ったら行数で割らず、後から単独で直したくなる塊ごとに分ける。
    rules: {
      "max-lines": [
        "error",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];

export default eslintConfig;
