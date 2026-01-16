# Đề xuất cải tiến cho ClipCrow MCP Server

Dựa trên những kinh nghiệm thu được từ quá trình triển khai phía client
(`serve.ts`) trong dự án này, chúng tôi đã tổng hợp các đề xuất cải tiến cho
ClipCrow MCP Server. Những đề xuất này nhằm mục đích giảm tải cho nhà phát triển
phía client và nâng cao khả năng tương thích với LLM (đặc biệt là Gemini).

## 1. Hiển thị rõ ràng Session ID trong phản hồi khởi tạo (Initialize Response)

**Hiện trạng:** Client sau khi gửi yêu cầu `initialize`, cần phải trích xuất
Session ID từ header phản hồi (`x-session-id`) hoặc từ sự kiện `endpoint` của
SSE.

**Vấn đề:** Điều này đòi hỏi phải phân tích header hoặc parse luồng SSE ngay từ
giai đoạn đầu, làm tăng rào cản cho việc triển khai client.

**Đề xuất:** Vui lòng đưa `sessionId` được cấp phát vào ngay trong phản hồi
thành công (JSON-RPC result) của phương thức `initialize`.

```json
// Ví dụ về phản hồi đề xuất
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "sessionId": "aedb303651144d63b0f6ea88baf94261", // Thêm vào
    "capabilities": { ... },
    "serverInfo": { ... }
  }
}
```

Việc này sẽ giúp client có thể lấy được ID như một giá trị trả về tiêu chuẩn của
JSON-RPC, loại bỏ sự cần thiết phải phân tích header hay chờ đợi SSE.

## 2. Cung cấp Schema tương thích với Gemini (hoặc chế độ Strict)

**Hiện trạng:** JSON Schema được trả về bởi `tools/list` có chứa các yếu tố sau
đây, gây ra lỗi với Gemini API:

1. `uniqueItems: true` (Gemini không hỗ trợ)
2. `enum` kiểu số (Gemini có xu hướng yêu cầu giá trị `enum` là chuỗi)

**Vấn đề:** Phía client buộc phải triển khai quy trình duyệt và sửa đổi
(sanitize) đệ quy schema, gây phát sinh chi phí bảo trì.

**Đề xuất:** Chúng tôi đề xuất phía server nên xử lý các vấn đề tương thích này.

- **Phương án A (Thay đổi mặc định):** Không xuất `uniqueItems`, và định nghĩa
  Enum dưới dạng chuỗi bất cứ khi nào có thể.
- **Phương án B (Tùy chọn):** Xuất ra schema có tính di động cao hơn (nới lỏng
  ràng buộc) khi thông tin client (`clientInfo`) có chứa `runtime: "gemini"`
  hoặc khi nhận được tham số `strict: true`.

## 3. Nới lỏng việc bắt buộc sử dụng SSE khi khởi tạo

**Hiện trạng:** Đối với lệnh gọi `initialize`, phản hồi được trả về ngay lập tức
với `Content-Type: text/event-stream`.

**Vấn đề:** Cần phải triển khai xử lý luồng (stream) chỉ cho một bước bắt tay
(handshake) đơn giản.

**Đề xuất:** Vui lòng xem xét tùy chọn (hoặc mặc định) trả về phản hồi
`application/json` thông thường cho các yêu cầu đơn lẻ như `initialize` hay
`tools/list`. SSE chỉ nên được nâng cấp khi cần thông báo hoặc các tác vụ kéo
dài, hoặc thiết kế việc thiết lập kết nối SSE thông qua một endpoint riêng biệt
như `/sse` sẽ dễ dàng hơn cho các client HTTP đơn giản.

## 4. Cụ thể hóa thông báo lỗi

**Hiện trạng:** Khi gửi yêu cầu mà không có Session ID, server trả về
`400 Bad Request`, nhưng lý do chi tiết không được bao gồm trong body (hoặc khó
nhìn thấy).

**Vấn đề:** Gây khó khăn cho việc debug và xác định nguyên nhân lỗi.

**Đề xuất:** Việc đưa ra giải pháp cụ thể trong body của phản hồi lỗi (JSON-RPC
Error Object) (Ví dụ: "Session ID missing. Please capture x-session-id from
initialize response.") sẽ giúp các nhà phát triển giải quyết vấn đề nhanh chóng
hơn.
