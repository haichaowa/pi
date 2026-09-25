import { AssistantMessageEventStream } from "../packages/ai/src/utils/event-stream.ts";

const stream = new AssistantMessageEventStream();

// 生产者：每 300ms push 一个事件（模拟 token 流）
let i = 0;
const timer = setInterval(() => {
    if (i < 3) {
        stream.push({ type: "text_delta", contentIndex: 0, delta: `块${i} `, partial: null as any });
        i++;
    } else {
        stream.push({ type: "done", reason: "stop", message: null as any });
        clearInterval(timer);
    }
}, 300);

// 消费者：for await 逐个收
for await (const event of stream) {
    console.log("收到:", event.type);
}
console.log("完成，结果:", await stream.result());