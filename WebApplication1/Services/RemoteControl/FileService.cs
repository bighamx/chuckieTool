using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace ChuckieHelper.WebApi.Services.RemoteControl;

public class FileService
{
    private readonly string _rootPath;

    public FileService()
    {
        // 设置可访问的根目录，默认为用户主目录
        _rootPath = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    /// <summary>
    /// 获取文件列表
    /// </summary>
    public List<FileInfo> GetFiles(string? path = null)
    {
        try
        {
            // 如果 path 为空或 null，返回所有驱动器列表
            if (string.IsNullOrEmpty(path))
            {
                return GetDrives();
            }

            var fullPath = ResolvePath(path);

            if (!Directory.Exists(fullPath))
            {
                return new List<FileInfo>();
            }

            var files = new List<FileInfo>();
            var directory = new DirectoryInfo(fullPath);

            // 获取子目录
            foreach (var dir in directory.GetDirectories())
            {
                try
                {
                    files.Add(new FileInfo
                    {
                        Name = dir.Name,
                        IsDirectory = true,
                        Path = dir.FullName,
                        Size = 0,
                        Modified = dir.LastWriteTime,
                        CanRead = true,
                        CanWrite = (dir.Attributes & FileAttributes.ReadOnly) == 0
                    });
                }
                catch
                {
                    // 跳过无法访问的目录
                }
            }

            // 获取文件
            foreach (var file in directory.GetFiles())
            {
                try
                {
                    files.Add(new FileInfo
                    {
                        Name = file.Name,
                        IsDirectory = false,
                        Path = file.FullName,
                        Size = file.Length,
                        Modified = file.LastWriteTime,
                        CanRead = true,
                        CanWrite = (file.Attributes & FileAttributes.ReadOnly) == 0
                    });
                }
                catch
                {
                    // 跳过无法访问的文件
                }
            }

            return files.OrderByDescending(f => f.IsDirectory).ThenBy(f => f.Name).ToList();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetFiles error: {ex.Message}");
            return new List<FileInfo>();
        }
    }

    /// <summary>
    /// 获取所有驱动器列表
    /// </summary>
    private List<FileInfo> GetDrives()
    {
        var drives = new List<FileInfo>();
        try
        {
            foreach (var drive in DriveInfo.GetDrives())
            {
                try
                {
                    // 检查驱动器是否就绪
                    if (drive.IsReady)
                    {
                        drives.Add(new FileInfo
                        {
                            Name = $"{drive.Name} ({drive.VolumeLabel})",
                            IsDirectory = true,
                            Path = drive.RootDirectory.FullName,
                            Size = 0,
                            Modified = DateTime.Now,
                            CanRead = true,
                            CanWrite = !drive.DriveType.Equals(DriveType.CDRom),
                            TotalBytes = drive.TotalSize,
                            FreeBytes = drive.AvailableFreeSpace
                        });
                    }
                    else
                    {
                        // 未就绪的驱动器也显示，但标记名称
                        drives.Add(new FileInfo
                        {
                            Name = $"{drive.Name} (未就绪)",
                            IsDirectory = true,
                            Path = drive.RootDirectory.FullName,
                            Size = 0,
                            Modified = DateTime.Now,
                            CanRead = false,
                            CanWrite = false
                        });
                    }
                }
                catch
                {
                    // 跳过无法访问的驱动器
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetDrives error: {ex.Message}");
        }
        return drives;
    }

    /// <summary>
    /// 读取文件内容
    /// </summary>
    public async Task<string> ReadFileAsync(string path)
    {
        try
        {
            var fullPath = ResolvePath(path);

            if (!System.IO.File.Exists(fullPath))
            {
                return "";
            }

            // 限制文件大小（防止读取过大的二进制文件）
            var fileInfo = new System.IO.FileInfo(fullPath);
            if (fileInfo.Length > 10 * 1024 * 1024) // 10MB
            {
                return "[文件过大，无法在线编辑]";
            }

            return await System.IO.File.ReadAllTextAsync(fullPath);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"ReadFile error: {ex.Message}");
            return "";
        }
    }

    /// <summary>
    /// 以流形式读取文件（直接二进制，用于十六进制编辑，2MB 限制）
    /// </summary>
    public Stream? OpenFileReadStream(string path)
    {
        try
        {
            var fullPath = ResolvePath(path);
            if (!System.IO.File.Exists(fullPath))
                return null;

            var fileInfo = new System.IO.FileInfo(fullPath);
            if (fileInfo.Length > 2 * 1024 * 1024) // 2MB 限制
                return null;

            return System.IO.File.OpenRead(fullPath);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"OpenFileReadStream error: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// 将请求体字节写入文件（十六进制编辑保存）
    /// </summary>
    public async Task<bool> WriteFileFromBytesAsync(string path, byte[] bytes)
    {
        try
        {
            var fullPath = ResolvePath(path);
            if (System.IO.File.Exists(fullPath))
            {
                var fileInfo = new System.IO.FileInfo(fullPath);
                if ((fileInfo.Attributes & FileAttributes.ReadOnly) != 0)
                    return false;
            }

            await System.IO.File.WriteAllBytesAsync(fullPath, bytes);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WriteFileFromBytes error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 写入文件内容
    /// </summary>
    public async Task<bool> WriteFileAsync(string path, string content)
    {
        try
        {
            var fullPath = ResolvePath(path);

            // 检查文件是否可写
            if (System.IO.File.Exists(fullPath))
            {
                var fileInfo = new System.IO.FileInfo(fullPath);
                if ((fileInfo.Attributes & FileAttributes.ReadOnly) != 0)
                {
                    return false;
                }
            }

            await System.IO.File.WriteAllTextAsync(fullPath, content);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"WriteFile error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 删除文件
    /// </summary>
    public bool DeleteFile(string path)
    {
        try
        {
            var fullPath = ResolvePath(path);

            if (!System.IO.File.Exists(fullPath))
            {
                return false;
            }

            System.IO.File.Delete(fullPath);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"DeleteFile error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 删除目录
    /// </summary>
    public bool DeleteDirectory(string path, bool recursive = true)
    {
        try
        {
            var fullPath = ResolvePath(path);

            if (!Directory.Exists(fullPath))
            {
                return false;
            }

            Directory.Delete(fullPath, recursive);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"DeleteDirectory error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 创建目录
    /// </summary>
    public bool CreateDirectory(string path)
    {
        try
        {
            var fullPath = ResolvePath(path);

            if (Directory.Exists(fullPath))
            {
                return true;
            }

            Directory.CreateDirectory(fullPath);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"CreateDirectory error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 复制文件
    /// </summary>
    public bool CopyFile(string sourcePath, string destPath, bool overwrite = false)
    {
        try
        {
            var fullSource = ResolvePath(sourcePath);
            var fullDest = ResolvePath(destPath);

            if (!System.IO.File.Exists(fullSource))
            {
                return false;
            }

            System.IO.File.Copy(fullSource, fullDest, overwrite);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"CopyFile error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 移动文件
    /// </summary>
    public bool MoveFile(string sourcePath, string destPath)
    {
        try
        {
            var fullSource = ResolvePath(sourcePath);
            var fullDest = ResolvePath(destPath);

            if (!System.IO.File.Exists(fullSource))
            {
                return false;
            }

            System.IO.File.Move(fullSource, fullDest, true);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"MoveFile error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 重命名文件或文件夹
    /// </summary>
    public bool Rename(string oldPath, string newPath)
    {
        try
        {
            var fullOld = ResolvePath(oldPath);
            var fullNew = ResolvePath(newPath);
            if (Directory.Exists(fullOld))
            {
                Directory.Move(fullOld, fullNew);
                return true;
            }
            if (System.IO.File.Exists(fullOld))
            {
                System.IO.File.Move(fullOld, fullNew, true);
                return true;
            }
            return false;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Rename error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 设置磁盘卷标（仅 Windows 支持，通过 label 命令）
    /// </summary>
    public bool SetDriveLabel(string path, string label)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return false;
        try
        {
            var fullPath = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (fullPath.Length < 2)
                return false;
            var root = fullPath.Length == 2 && fullPath[1] == ':'
                ? fullPath
                : Path.GetPathRoot(fullPath);
            if (string.IsNullOrEmpty(root))
                return false;
            var driveLetter = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (driveLetter.Length != 2 || driveLetter[1] != ':')
                return false;
            var volumeLabel = (label ?? "").Trim();
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "cmd.exe",
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("/c");
            psi.ArgumentList.Add("label");
            psi.ArgumentList.Add(driveLetter);
            psi.ArgumentList.Add(volumeLabel);
            using var p = System.Diagnostics.Process.Start(psi);
            if (p == null) return false;
            p.WaitForExit(5000);
            return p.ExitCode == 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SetDriveLabel error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 获取文件下载字节数据
    /// </summary>
    public async Task<byte[]> GetFileDownloadAsync(string path)
    {
        try
        {
            var fullPath = ResolvePath(path);

            if (!System.IO.File.Exists(fullPath))
            {
                return Array.Empty<byte>();
            }

            return await System.IO.File.ReadAllBytesAsync(fullPath);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetFileDownload error: {ex.Message}");
            return Array.Empty<byte>();
        }
    }

    /// <summary>
    /// 获取文件流信息（用于视频流式播放，支持 Range 请求）
    /// </summary>
    public (FileStream? Stream, string ContentType, long FileSize) GetFileStream(string path)
    {
        try
        {
            var fullPath = ResolvePath(path);

            if (!System.IO.File.Exists(fullPath))
            {
                return (null, "", 0);
            }

            var fileInfo = new System.IO.FileInfo(fullPath);
            var contentType = GetContentType(fullPath);
            var stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);

            return (stream, contentType, fileInfo.Length);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetFileStream error: {ex.Message}");
            return (null, "", 0);
        }
    }

    /// <summary>
    /// 获取图片压缩预览（限制最大分辨率和体积）
    /// </summary>
    public byte[] GetImagePreview(string path, int maxWidth = 1920, int maxHeight = 1080, int quality = 80)
    {
        try
        {
            var fullPath = ResolvePath(path);

            if (!System.IO.File.Exists(fullPath))
            {
                return Array.Empty<byte>();
            }

            using var originalStream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var original = Image.FromStream(originalStream);

            // 计算缩放后的尺寸，保持宽高比
            var ratioX = (double)maxWidth / original.Width;
            var ratioY = (double)maxHeight / original.Height;
            var ratio = Math.Min(ratioX, ratioY);

            // 如果原图已经小于限制，且文件小于 2MB，则直接返回原始文件
            if (ratio >= 1.0)
            {
                var fileInfo = new System.IO.FileInfo(fullPath);
                if (fileInfo.Length <= 2 * 1024 * 1024)
                {
                    return System.IO.File.ReadAllBytes(fullPath);
                }
            }

            // 需要缩放
            var newWidth = ratio < 1.0 ? (int)(original.Width * ratio) : original.Width;
            var newHeight = ratio < 1.0 ? (int)(original.Height * ratio) : original.Height;

            using var resized = new Bitmap(newWidth, newHeight);
            using (var graphics = Graphics.FromImage(resized))
            {
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.SmoothingMode = SmoothingMode.HighQuality;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.CompositingQuality = CompositingQuality.HighQuality;
                graphics.DrawImage(original, 0, 0, newWidth, newHeight);
            }

            // 使用 JPEG 编码并控制质量
            var encoder = ImageCodecInfo.GetImageEncoders()
                .FirstOrDefault(e => e.FormatID == ImageFormat.Jpeg.Guid);

            if (encoder == null)
            {
                // 回退：直接以 PNG 输出
                using var ms = new MemoryStream();
                resized.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }

            var encoderParams = new EncoderParameters(1);
            encoderParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);

            using var outputStream = new MemoryStream();
            resized.Save(outputStream, encoder, encoderParams);
            return outputStream.ToArray();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetImagePreview error: {ex.Message}");
            return Array.Empty<byte>();
        }
    }

    /// <summary>
    /// 根据文件扩展名获取 MIME 类型
    /// </summary>
    private static string GetContentType(string filePath)
    {
        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        return ext switch
        {
            ".mp4" => "video/mp4",
            ".webm" => "video/webm",
            ".ogg" or ".ogv" => "video/ogg",
            ".avi" => "video/x-msvideo",
            ".mov" => "video/quicktime",
            ".mkv" => "video/x-matroska",
            ".flv" => "video/x-flv",
            ".wmv" => "video/x-ms-wmv",
            ".m4v" => "video/x-m4v",
            ".3gp" => "video/3gpp",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".gif" => "image/gif",
            ".bmp" => "image/bmp",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            ".tif" or ".tiff" => "image/tiff",
            _ => "application/octet-stream"
        };
    }

    /// <summary>
    /// 解析路径（防止目录遍历攻击）
    /// </summary>
    private string ResolvePath(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return _rootPath;
        }

        // 检查是否是 Windows 绝对路径（例如 D:\、C:\）
        if (Path.IsPathRooted(path))
        {
            // 对于绝对路径，直接使用，但要规范化
            try
            {
                return Path.GetFullPath(path);
            }
            catch
            {
                return _rootPath;
            }
        }

        // 如果是相对路径，相对于根目录解析
        var targetPath = path.StartsWith("/") ? path.Substring(1) : path;
        var fullPath = Path.Combine(_rootPath, targetPath);

        // 解析完整路径并检查是否仍在根目录内
        var resolvedPath = Path.GetFullPath(fullPath);
        var resolvedRoot = Path.GetFullPath(_rootPath);

        if (!resolvedPath.StartsWith(resolvedRoot, StringComparison.OrdinalIgnoreCase))
        {
            // 拒绝目录遍历尝试
            return _rootPath;
        }

        return resolvedPath;
    }

    /// <summary>
    /// 获取相对于根目录的路径
    /// </summary>
    private string GetRelativePath(string fullPath)
    {
        if (fullPath.StartsWith(_rootPath, StringComparison.OrdinalIgnoreCase))
        {
            return fullPath.Substring(_rootPath.Length).TrimStart(Path.DirectorySeparatorChar);
        }
        return fullPath;
    }
}

/// <summary>
/// 文件信息
/// </summary>
public class FileInfo
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public bool IsDirectory { get; set; }
    public long Size { get; set; }
    public DateTime Modified { get; set; }
    public bool CanRead { get; set; }
    public bool CanWrite { get; set; }
    /// <summary>磁盘总字节数（仅根路径驱动器列表时有值）</summary>
    public long? TotalBytes { get; set; }
    /// <summary>磁盘可用字节数（仅根路径驱动器列表时有值）</summary>
    public long? FreeBytes { get; set; }
}
