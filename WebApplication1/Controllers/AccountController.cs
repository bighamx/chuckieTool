using Microsoft.AspNetCore.Mvc;

namespace ChuckieHelper.WebApi.Controllers;

public class AccountController : Controller
{
    [HttpGet]
    public IActionResult Login()
    {
        return View();
    }

    [HttpGet]
    public IActionResult Logout()
    {
        Response.Cookies.Delete("access_token");
        return RedirectToAction("Login");
    }
}
