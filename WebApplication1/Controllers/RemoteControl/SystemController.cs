using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ChuckieHelper.WebApi.Services.RemoteControl;

namespace ChuckieHelper.WebApi.Controllers.RemoteControl;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SystemController : ControllerBase
{
    private readonly SystemService _systemService;

    public SystemController(SystemService systemService)
    {
        _systemService = systemService;
    }

    [HttpPost("shutdown")]
    public IActionResult Shutdown()
    {
        _systemService.Shutdown();
        return Ok(new { message = "System will shutdown in 5 seconds" });
    }

    [HttpPost("cancel-shutdown")]
    public IActionResult CancelShutdown()
    {
        _systemService.CancelShutdown();
        return Ok(new { message = "Shutdown cancelled" });
    }

    [HttpPost("sleep")]
    public IActionResult Sleep()
    {
        _systemService.Sleep();
        return Ok(new { message = "System is sleeping" });
    }

    [HttpPost("hibernate")]
    public IActionResult Hibernate()
    {
        _systemService.Hibernate();
        return Ok(new { message = "System is hibernating" });
    }

    [HttpGet("processes")]
    public async Task<IActionResult> GetProcesses()
    {
        var processes = await _systemService.GetProcessListAsync();
        return Ok(processes);
    }

    [HttpPost("kill/{processId}")]
    public IActionResult KillProcess(int processId)
    {
        var success = _systemService.KillProcess(processId);
        if (success)
        {
            return Ok(new { message = $"Process {processId} terminated" });
        }
        return BadRequest(new { message = $"Failed to terminate process {processId}" });
    }

    [HttpPost("lock")]
    public IActionResult LockWorkstation()
    {
        _systemService.LockWorkstation();
        return Ok(new { message = "Workstation locked" });
    }

    [HttpGet("screenshot")]
    public IActionResult GetScreenshot()
    {
        var imageBytes = _systemService.CaptureScreen();
        if (imageBytes.Length == 0)
        {
            return StatusCode(500, new { message = "Failed to capture screenshot" });
        }
        return File(imageBytes, "image/jpeg");
    }

    [HttpGet("info")]
    public IActionResult GetSystemInfo()
    {
        var info = _systemService.GetSystemInfo();
        return Ok(info);
    }
}
