using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ChuckieHelper.WebApi.Services.RemoteControl;

namespace ChuckieHelper.WebApi.Controllers.RemoteControl;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly FileService _fileService;

    public FilesController(FileService fileService)
    {
        _fileService = fileService;
    }

    /// <summary>
    /// 获取文件列表
    /// </summary>
    [HttpGet("list")]
    public IActionResult GetFiles([FromQuery] string? path = null)
    {
        try
        {
            var files = _fileService.GetFiles(path);
            return Ok(new { data = files });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 读取文件内容（binary=true 时直接返回二进制流）
    /// </summary>
    [HttpGet("read")]
    public async Task<IActionResult> ReadFile([FromQuery] string path, [FromQuery] bool binary = false)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
                return BadRequest(new { message = "Path is required" });

            if (binary)
            {
                var stream = _fileService.OpenFileReadStream(path);
                if (stream == null)
                    return BadRequest(new { message = "文件不存在或超过 2MB 限制" });
                return File(stream, "application/octet-stream");
            }

            var content = await _fileService.ReadFileAsync(path);
            return Ok(new { content });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 写入文件内容（文本）
    /// </summary>
    [HttpPost("write")]
    public async Task<IActionResult> WriteFile([FromBody] WriteFileRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.Path))
                return BadRequest(new { message = "Path is required" });

            var result = await _fileService.WriteFileAsync(request.Path, request.Content ?? "");
            if (result)
                return Ok(new { message = "File written successfully" });
            return BadRequest(new { message = "Failed to write file" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 以二进制流写入文件（请求体为原始字节，用于十六进制编辑保存）
    /// </summary>
    [HttpPost("write-binary")]
    public async Task<IActionResult> WriteFileBinary([FromQuery] string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
                return BadRequest(new { message = "Path is required" });

            using var ms = new MemoryStream();
            await Request.Body.CopyToAsync(ms);
            var bytes = ms.ToArray();

            var result = await _fileService.WriteFileFromBytesAsync(path, bytes);
            if (result)
                return Ok(new { message = "File written successfully" });
            return BadRequest(new { message = "Failed to write file" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 删除文件
    /// </summary>
    [HttpPost("delete")]
    public IActionResult DeleteFile([FromQuery] string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
            {
                return BadRequest(new { message = "Path is required" });
            }

            var result = _fileService.DeleteFile(path);
            if (result)
            {
                return Ok(new { message = "File deleted successfully" });
            }
            return BadRequest(new { message = "Failed to delete file" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 删除目录
    /// </summary>
    [HttpPost("delete-directory")]
    public IActionResult DeleteDirectory([FromQuery] string path, [FromQuery] bool recursive = true)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
            {
                return BadRequest(new { message = "Path is required" });
            }

            var result = _fileService.DeleteDirectory(path, recursive);
            if (result)
            {
                return Ok(new { message = "Directory deleted successfully" });
            }
            return BadRequest(new { message = "Failed to delete directory" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 创建目录
    /// </summary>
    [HttpPost("create-directory")]
    public IActionResult CreateDirectory([FromBody] CreateDirectoryRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.Path))
            {
                return BadRequest(new { message = "Path is required" });
            }

            var result = _fileService.CreateDirectory(request.Path);
            if (result)
            {
                return Ok(new { message = "Directory created successfully" });
            }
            return BadRequest(new { message = "Failed to create directory" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 复制文件
    /// </summary>
    [HttpPost("copy")]
    public IActionResult CopyFile([FromBody] CopyFileRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.SourcePath) || string.IsNullOrEmpty(request.DestPath))
            {
                return BadRequest(new { message = "SourcePath and DestPath are required" });
            }

            var result = _fileService.CopyFile(request.SourcePath, request.DestPath, request.Overwrite);
            if (result)
            {
                return Ok(new { message = "File copied successfully" });
            }
            return BadRequest(new { message = "Failed to copy file" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 移动文件
    /// </summary>
    [HttpPost("move")]
    public IActionResult MoveFile([FromBody] MoveFileRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.SourcePath) || string.IsNullOrEmpty(request.DestPath))
            {
                return BadRequest(new { message = "SourcePath and DestPath are required" });
            }

            var result = _fileService.MoveFile(request.SourcePath, request.DestPath);
            if (result)
            {
                return Ok(new { message = "File moved successfully" });
            }
            return BadRequest(new { message = "Failed to move file" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 下载文件
    /// </summary>
    [HttpGet("download")]
    public async Task<IActionResult> DownloadFile([FromQuery] string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
            {
                return BadRequest(new { message = "Path is required" });
            }

            var fileBytes = await _fileService.GetFileDownloadAsync(path);
            if (fileBytes.Length == 0)
            {
                return NotFound(new { message = "File not found" });
            }

            var fileName = System.IO.Path.GetFileName(path);
            return File(fileBytes, "application/octet-stream", fileName);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 流式传输文件（支持 Range 请求，用于视频流式播放）
    /// </summary>
    [HttpGet("stream")]
    public IActionResult StreamFile([FromQuery] string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
            {
                return BadRequest(new { message = "Path is required" });
            }

            var (stream, contentType, fileSize) = _fileService.GetFileStream(path);
            if (stream == null)
            {
                return NotFound(new { message = "File not found" });
            }

            // 启用 Range 请求支持，浏览器自动处理 206 Partial Content
            Response.Headers["Accept-Ranges"] = "bytes";
            return File(stream, contentType, enableRangeProcessing: true);
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 图片压缩预览（限制最大分辨率和体积）
    /// </summary>
    [HttpGet("preview-image")]
    public IActionResult PreviewImage(
        [FromQuery] string path,
        [FromQuery] int maxWidth = 1920,
        [FromQuery] int maxHeight = 1080,
        [FromQuery] int quality = 80)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
            {
                return BadRequest(new { message = "Path is required" });
            }

            // 限制参数范围
            maxWidth = Math.Clamp(maxWidth, 100, 3840);
            maxHeight = Math.Clamp(maxHeight, 100, 2160);
            quality = Math.Clamp(quality, 10, 100);

            var imageBytes = _fileService.GetImagePreview(path, maxWidth, maxHeight, quality);
            if (imageBytes.Length == 0)
            {
                return NotFound(new { message = "Image not found or not supported" });
            }

            return File(imageBytes, "image/jpeg");
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// 上传文件
    /// </summary>
    [HttpPost("upload")]
    public async Task<IActionResult> UploadFile([FromQuery] string path)
    {
        try
        {
            if (string.IsNullOrEmpty(path))
            {
                return BadRequest(new { message = "Path is required" });
            }

            var files = Request.Form.Files;
            if (files.Count == 0)
            {
                return BadRequest(new { message = "No file uploaded" });
            }

            var file = files[0];
            var uploadPath = System.IO.Path.Combine(path, file.FileName);

            using (var stream = new MemoryStream())
            {
                await file.CopyToAsync(stream);
                var fileBytes = stream.ToArray();
                var content = System.Text.Encoding.UTF8.GetString(fileBytes);
                var result = await _fileService.WriteFileAsync(uploadPath, content);

                if (result)
                {
                    return Ok(new { message = "File uploaded successfully", fileName = file.FileName });
                }
            }

            return BadRequest(new { message = "Failed to upload file" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}

public class WriteFileRequest
{
    public string Path { get; set; } = "";
    public string? Content { get; set; }
}

public class CreateDirectoryRequest
{
    public string Path { get; set; } = "";
}

public class CopyFileRequest
{
    public string SourcePath { get; set; } = "";
    public string DestPath { get; set; } = "";
    public bool Overwrite { get; set; }
}

public class MoveFileRequest
{
    public string SourcePath { get; set; } = "";
    public string DestPath { get; set; } = "";
}
