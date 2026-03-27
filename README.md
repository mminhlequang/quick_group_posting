# Quick Group Posting (Chrome Extension)

Extension Chrome giúp đăng bài nhanh vào các Facebook Group từ trang Groups, tối ưu thao tác lặp lại khi bạn cần chia sẻ cùng một nội dung cho nhiều nhóm.

## 1. Tính năng chính

- Lưu nội dung bài đăng trong popup (`Post Content`) và tự động lưu vào `chrome.storage.local`.
- Chèn nút `Quick post` trực tiếp cạnh nút `View group/Visit` trên trang Facebook Groups.
- Đăng 1 chạm vào từng group bằng GraphQL request trong ngữ cảnh trang.
- Lưu lịch sử group đã đăng gần đây (`Recent Groups`) để tái sử dụng nhanh.
- Chọn nhiều group và đăng hàng loạt (`Post to selected groups`).
- Hỗ trợ random delay giữa các lần đăng (min/max giây) để phân bổ nhịp đăng.
- Đồng bộ trạng thái giữa content script và popup thông qua `chrome.storage`.

## 2. Luồng hoạt động

1. Bạn nhập nội dung bài viết trong popup.
2. Trên trang Groups, extension tự tìm card group phù hợp và chèn nút `Quick post`.
3. Khi bấm nút, content script gửi yêu cầu sang script chạy trong MAIN world của trang.
4. Script MAIN world lấy token phiên (`fb_dtsg`, `lsd`, user id, spin token) và gọi API GraphQL để tạo bài viết trong group.
5. Kết quả trả về được cập nhật trạng thái thành công/thất bại và lưu lịch sử group.

## 3. Cài đặt local (Developer mode)

1. Mở `chrome://extensions`.
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Trỏ tới thư mục dự án `quick_group_posting`.
5. Mở Facebook Groups và bắt đầu sử dụng từ popup extension.

## 4. Cấu trúc thư mục

- `manifest.json`: cấu hình extension (MV3, permissions, content scripts).
- `background.js`: khởi tạo dữ liệu mặc định và router message.
- `shared/storage.js`: wrapper thao tác `chrome.storage.local`.
- `content/injectButtons.js`: quét DOM, chèn nút Quick post, xử lý bulk post.
- `content/helpers.js`: helper lấy token/thông tin phiên Facebook.
- `content/injectGraphQL.js`: gửi request GraphQL để tạo bài đăng.
- `popup/popup.html`, `popup/popup.js`, `popup/popup.css`: giao diện và logic popup.

## 5. Ứng dụng phù hợp trong thực tiễn

- Social Admin quản lý nhiều cộng đồng cùng chủ đề, cần thông báo đồng bộ.
- Seller/cửa hàng online đăng chương trình khuyến mãi vào nhiều nhóm đã tham gia.
- Cộng tác viên tuyển dụng chia sẻ tin tuyển dụng định kỳ theo danh sách group mục tiêu.
- Đội vận hành sự kiện cần broadcast thông tin cập nhật vào các group liên quan.
- Team marketing nội bộ cần thử nghiệm nội dung (A/B theo thời gian đăng, nhóm đăng).

## 6. Khi nào không nên dùng

- Không phù hợp cho spam hàng loạt hoặc nội dung vi phạm chính sách nền tảng.
- Không phù hợp nếu bạn cần workflow duyệt nội dung nhiều cấp trước khi đăng.
- Không phù hợp khi đăng nội dung đa phương tiện phức tạp (video, album lớn) mà API hiện tại chưa hỗ trợ.

## 7. Lưu ý vận hành

- Chỉ dùng cho các group bạn có quyền đăng bài.
- Facebook có thể thay đổi DOM, token hoặc GraphQL `doc_id`, cần bảo trì định kỳ.
- Tần suất đăng quá dày có thể làm tăng rủi ro bị giới hạn tài khoản.
- Nên kiểm tra nội dung, tần suất và khung giờ đăng để đảm bảo chất lượng tương tác.

## 8. Định hướng cải tiến

- Hỗ trợ nhiều template nội dung thay vì 1 `activeText`.
- Thêm preview trước khi đăng hàng loạt.
- Thêm retry policy thông minh theo từng loại lỗi.
- Export/import danh sách group và lịch sử đăng.
- Dashboard thống kê tỷ lệ thành công theo nhóm và theo thời gian.
