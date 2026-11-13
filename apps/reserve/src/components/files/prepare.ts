/**
 * アップロード前の準備。大きな写真は長い辺 2400px・JPEG に縮小して、通信量と保存容量を抑える。
 * （端末で読めない形式＝HEIC など は、そのまま送る）
 */
const MAX_SIDE = 2400;
const SHRINK_OVER_BYTES = 1.5 * 1024 * 1024;

export const ACCEPT_FILES = "image/*,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function prepareFile(file: File): Promise<{ blob: Blob; name: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= SHRINK_OVER_BYTES) {
      bmp.close();
      return { blob: file, name: file.name };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return { blob: file, name: file.name };
    return { blob, name: file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg" };
  } catch {
    return { blob: file, name: file.name };
  }
}
