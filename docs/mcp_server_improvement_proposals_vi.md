# Yêu cầu cải tiến cho ClipCrow MCP Server

Dựa trên những kinh nghiệm thu được từ việc triển khai client (Deno + Gemini
SDK) trong dự án này, chúng tôi đã tổng hợp các yêu cầu cải tiến cho ClipCrow
MCP Server. Đây là những kỳ vọng mạnh mẽ nhằm mục đích làm cho server trở nên
mạnh mẽ hơn và thân thiện với nhà phát triển hơn đối với nhiều loại LLM client
khác nhau, bao gồm cả Gemini.

## 1. Đơn giản hóa định nghĩa Schema (Thiết kế thân thiện với LLM)

**Hiện trạng:** Trong một số định nghĩa tool, chúng tôi thấy có các mô tả rất
chi tiết và định nghĩa kiểu phức tạp (nesting sâu, cấu trúc đệ quy, `anyOf`,
v.v.). Mặc dù điều này là chính xác để biểu diễn kiểu dữ liệu, nhưng đối với một
số LLM như Gemini, nó gây ra lỗi bị từ chối ở cấp độ API do "quá nhiều trạng
thái (Too many states)" hoặc tiêu tốn một lượng lớn token.

**Yêu cầu:**

- **Rút gọn mô tả**: Giữ cho `description` ở độ dài tối thiểu mà LLM có thể hiểu
  được (Kỳ vọng: dưới 150 ký tự). Tài liệu quá dài sẽ làm đầy context window.
- **Tránh các kiểu phức hợp**: Các JSON Schema combinator như `anyOf`, `oneOf`,
  `allOf` rất khó để chức năng function calling của LLM giải nghĩa và thường là
  nguồn gốc gây ra lỗi. Chúng tôi yêu cầu mạnh mẽ sử dụng định nghĩa property
  phẳng (flat) nhất có thể.
- **Lược bỏ mô tả property**: Nếu tên biến đã tự giải thích (ví dụ: `message`,
  `target_id`), thì có thể lược bỏ `description` cho từng property. Điều này
  giúp loại bỏ nhu cầu xử lý "cắt tỉa" ở phía client.

## 2. Nâng cao tính linh hoạt trong giải quyết ID (UUID vs Serial No)

**Hiện trạng:** Các tool chính như `Send_message` yêu cầu UUID chính xác
(`target_id`) làm tham số. Tuy nhiên, trong context của LLM (prompt, v.v.),
thường chỉ chứa "số serial" dễ đọc cho con người, dẫn đến việc model thường
xuyên truyền nhầm số serial thay vì UUID và gây ra lỗi.

**Yêu cầu:**

**Yêu cầu:**

- **Đổi tên tham số (`target_id` -> `target`)**: Vì field này sẽ chấp nhận cả số
  serial, chúng tôi kỳ vọng đổi tên thành một cái tên tổng quát hơn (ví dụ:
  `target`).
- **Hỗ trợ số serial (Native Support)**: Mở rộng logic để trường `target` có thể
  chấp nhận cả UUID và số serial (số nguyên).
- **Chấp nhận sự mơ hồ**: Bằng cách thực hiện giải quyết động ở phía server như
  "nếu nhận được số thì tìm kiếm như số serial", "nếu là chuỗi thì tìm kiếm như
  UUID", chúng ta có thể tránh được quy trình xử lý nhiều bước "tìm kiếm -> gửi"
  ở phía client, từ đó cải thiện UX.

## 3. Tự động suy luận và loại bỏ Target Type trong định nghĩa Tool

**Hiện trạng:** Trong `Send_message`, trường `target_type` có thể là `records`,
`chats` hoặc `external_links`, và client buộc phải chỉ định chính xác. Tuy
nhiên, việc chọn đúng type cho các đối tượng nằm ở vùng ranh giới như Bot là
không trực quan và dễ gây ra lỗi.

**Yêu cầu:**

- **Loại bỏ tham số Target Type**: Để ngăn chặn sự nhầm lẫn và đơn giản hóa
  schema, chúng tôi yêu cầu mạnh mẽ việc **xóa bỏ** hoàn toàn tham số
  `target_type`.
- **Giải quyết tự động phía Server**: UUID là duy nhất trên toàn hệ thống và số
  serial là duy nhất trong phạm vi workspace. Chỉ cần ID được truyền vào, phía
  server hoàn toàn có thể xác định duy nhất bảng dữ liệu đích. Thay vì yêu cầu
  client chỉ định type, server cần thực hiện luồng suy luận tự động dựa trên ID.

## 4. Hiển thị rõ Session ID trong phản hồi khởi tạo

**Hiện trạng:** Client cần phải trích xuất Session ID từ response header
(`x-session-id`) hoặc sự kiện `endpoint` của SSE sau khi gửi request
`initialize`.

**Vấn đề:** `StreamableHTTPClientTransport` của `@modelcontextprotocol/sdk` được
sử dụng trong dự án này đã ẩn việc xử lý này bên trong, nên đây không phải là
vấn đề lớn đối với người dùng SDK. Tuy nhiên, đối với các client nhẹ không sử
dụng SDK hoặc khi tự triển khai HTTP, việc phân tích header và chờ đợi SSE là
bắt buộc và trở thành rào cản.

**Yêu cầu:** Để nâng cao tính linh hoạt, chúng tôi kỳ vọng (mức độ ưu tiên thấp)
nên hiển thị rõ `mcpSessionId` đã được cấp phát ngay trong phản hồi thành công
(`result`) của phương thức `initialize`.

```json
// Ví dụ phản hồi đề xuất
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "mcpSessionId": "aedb303651144d63b0f6ea88baf94261",
    "capabilities": { ... },
    "serverInfo": { ... }
  }
}
```

Nhờ đó, client có thể lấy ID như một giá trị trả về JSON-RPC tiêu chuẩn, loại bỏ
nhu cầu phân tích header hoặc chờ đợi SSE.

## 5. Kết luận

Phía client (`serve.ts`) đã áp dụng chiến lược "Scorched Earth (Tiêu thổ)" để ép
buộc định dạng schema phức tạp hiện tại cho tương thích, nhưng nếu phía server
thực hiện các điều chỉnh "thân thiện với LLM" như trên, việc triển khai client
sẽ trở nên đơn giản hơn nhiều và cũng dễ dàng hơn để hỗ trợ các model LLM khác.
