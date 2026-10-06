# Непрерывная штриховка — 1.8.19

В 1.8.18 фон пустой стороны начинался заново в каждой строке. Высота строки обычно не кратна периоду узора (8 px), поэтому на стыках появлялись разрывы и рябь.

Фон перенесён на таблицу целиком. Отсутствующие строки прозрачны, реальные строки и номера закрывают узор непрозрачной основой. Красный и зелёный оттенки накладываются поверх этой основы. `background-attachment: fixed` не используется; обработчики прокрутки и измерения DOM не добавлены.

## Проверки

- 32 сравнения пикселей пустых областей с цельным эталоном: обе стороны, светлая/тёмная тема, шрифты 13/14/17.5/20, zoom 0.8/1/1.25, DPR 1/2, прокрутка по обеим осям. Все прошли; старый CSS дал 36.5% отличающихся пикселей уже в первом сценарии.
- Отдельные пиксельные проверки реальных пустых строк: без штриховки, с сохранёнными цветами добавления/удаления.
- Существующие browser-проверки номеров при горизонтальной прокрутке, сворачивания контекста и EOF-маркеров проходят в обеих раскладках.
- A/B в headless Chromium на присланном 6k: SBS scroll p95 25 → 25 мс, максимум 33.4 → 32.5 мс, paint events 855 → 855, максимум слоёв 49 → 49, площадь paint +0.015%. Признаков возврата прежней перерисовки при прокрутке нет.
- В контрольном line-by-line CSS не применяется: количество и площадь paint совпали, но p95 колебалось 17.5 → 25 мс и была одиночная пауза 54 мс. Это один локальный A/B-прогон, а не гарантия плавности на любом устройстве.

Числа и синтетический скриншот: `diagonal-fill-1.8.19/`. Приватный diff не включён. Browser harness использует настоящий renderer/CSS и синтетические файлы.

## Повторение

Node.js 22, npm и Playwright/Chromium:

```sh
npm ci
npm run build:prod
node integration/browser/diagonal-fill.cjs
node integration/browser/scroll-gutter.cjs
node integration/browser/context-folding.cjs
node integration/browser/no-newline.cjs
DIFF_BENCH_ONLY=expanded DIFF_BENCH_FORMAT=side-by-side node integration/browser/large-diff.cjs
npx vsce package --no-dependencies --githubBranch main -o local-builds/diff-viewer-1.8.19-continuous-stripes.vsix
```

`DIFF_DIAGONAL_BASELINE_CSS` задаёт старый CSS для воспроизведения ряби. Для performance A/B используются сохранённые bundle/styles через `DIFF_BENCH_ASSETS`; внешний private input можно задать через `DIFF_BENCH_SCROLL_FIXTURE`. Без него используется синтетический пример.
