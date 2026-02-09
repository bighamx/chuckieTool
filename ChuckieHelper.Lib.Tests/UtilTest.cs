using Xunit;

namespace ChuckieHelper.Lib.Tool.Tests
{
    public class UtilTest
    {
        [Fact]
        public void TestSmartExtract()
        {
            string rarPath = @"H:\ERO\GirlsDelta_Collection_1800~2099\[GirlsDelta][1803][MASUMI][吉本真澄][T155_B87_W79_H90][P8, M8]\[GirlsDelta][1803][MASUMI][吉本真澄][T155_B87_W79_H90][160p_JPG].rar";
            var extractedFiles = Util.SmartExtract(rarPath);
            Assert.NotEmpty(extractedFiles);
        }
    }
}
