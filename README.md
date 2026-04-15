# Mini-Agent-CLI
一个叫 mini-agent 的 CLI
它是你自己写的，没有奇迹，没有黑盒；它能帮你日常改代码，也能作为你后续做更大 agent 产品的起点。


最终产物
跑起来是这样：

$ mini-agent
> 帮我修 src/parser.ts 里那个 off-by-one bug
[读 src/parser.ts]
[改 src/parser.ts 第 42 行]
[跑 bun test src/parser.test.ts]
搞定。offset 应该是 start，不是 start + 1。测试全绿。
> /compact
[压缩了 12 条消息，节省了 8k token]
> /exit
具体能力：

多轮对话 + 流式输出
7 个内置工具：read / write / edit / bash / grep / glob / ls
每次写文件或执行命令前弹权限确认
Bash 默认走沙箱
会话以 JSONL 持久化，可 --resume，可 /fork
上下文逼近窗口时自动压缩
可用 skill（markdown 指令包）扩能力
可写 hook 在工具调用前后插入自定义逻辑
配置文件里换模型，不动代码
bun build --compile 打包成单文件可执行