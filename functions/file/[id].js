export async function onRequest(context) {
  const { request, env, params } = context;

  const url = new URL(request.url);
  let fileUrl = "https://telegra.ph/" + url.pathname + url.search;
  // 提取 Telegram file_id（不带扩展名）
  const fileId = url.pathname.split(".")[0].split("/")[2];

  // --- 防盗链修改开始 ---

  const referer = request.headers.get("Referer");
  
  // 1. 构建白名单：使用裸域名 (hostname)，以匹配 ALLOWED_ORIGINS 的配置
  const allowedHosts = new Set([
    url.hostname, // 将请求自身的域名（如 img.yourdomain.com）加入白名单
    ...String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase()) // 统一转换为小写并清理空格
      .filter(Boolean)
  ]);

  // 2. 修复 ALLOWED_REFERER 的布尔值转换问题
  // 默认开启防盗链 (false)，除非环境变量明确设置为 "true"
  let isHotlinkAllowed = String(env.ALLOWED_REFERER).toLowerCase() === 'true';

  if (!isHotlinkAllowed) {
    // 只有在防盗链被显式启用 (isHotlinkAllowed 为 false) 时，才执行严格检查

    let refererPassed = false;

    if (!referer) {
      // 关键：如果 Referer 为空（例如 App 或浏览器直接打开），则放行
      refererPassed = true; 
    } else {
      // 否则，如果 Referer 存在，执行白名单检查
      try {
        const r = new URL(referer);
        const refHostname = r.hostname.toLowerCase();
        
        // 本地开发域名直接放行
        if (refHostname === 'localhost' || refHostname === '127.0.0.1') {
          refererPassed = true;
        } 
        // 检查 Referer 的裸域名是否在白名单中
        else if (allowedHosts.has(refHostname)) {
          refererPassed = true;
        }
      } catch (e) {
        // Referer 不合法时，视为未通过
      }
    }

    if (!refererPassed) {
      // 如果防盗链启用，且 Referer 检查未通过，则拦截
      return new Response("Hotlink forbidden", {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8"
        }
      });
    }
  }
  // --- 防盗链修改结束 ---

  if (fileId) {
    const filePath = await getFilePath(env, fileId);
    fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
  }

  const response = await fetch(fileUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  // Log response details
  console.log(response.ok, response.status);

  // If the response is OK, proceed with further checks
  if (response.ok) {

    // 从 URL 路径中提取完整的文件名（包括扩展名）
    const fullFileName = url.pathname.split("/").pop() || fileId;

    // Initialize minimal KV metadata if missing (key = fileId.ext)
    if (env.img_url && fileId) {
      const kvKey = fullFileName.includes('.') ? fullFileName : fileId;

      const record = await env.img_url.getWithMetadata(kvKey);
      if (!record || !record.metadata) {
        await env.img_url.put(kvKey, "", {
          metadata: { TimeStamp: Date.now() }
        });
      }
    }
    // 强制浏览器内联预览而不是下载
    const headers = new Headers(response.headers);
    // 透传类型，但覆盖 Content-Disposition
    const filename = fullFileName || "file";
    headers.set("Content-Disposition", `inline; filename="${filename}"`);
    const ext = filename.split(".").pop();
    if (ext) {
      const mime = {
        avif: "image/avif",
        bmp: "image/bmp",
        gif: "image/gif",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        jfif: "image/jpeg",
        png: "image/png",
        svg: "image/svg+xml",
        webp: "image/webp",
        mp4: "video/mp4",
        webm: "video/webm",
        mp3: "audio/mpeg",
        ogg: "audio/ogg",
        wav: "audio/wav",
        pdf: "application/pdf"
      }[ext.toLowerCase()];
      const currentContentType = headers.get("Content-Type");
      if (mime && (!currentContentType || currentContentType === "application/octet-stream")) {
        headers.set("Content-Type", mime);
      }
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  return response;
}

async function getFilePath(env, file_id) {
  try {
    const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
    const res = await fetch(url, {
      method: "GET"
    });

    if (!res.ok) {
      console.error(`HTTP error! status: ${res.status}`);
      return null;
    }

    const responseData = await res.json();
    const { ok, result } = responseData;

    if (ok && result) {
      return result.file_path;
    } else {
      console.error("Error in response data:", responseData);
      return null;
    }
  } catch (error) {
    console.error("Error fetching file path:", error.message);
    return null;
  }
}
