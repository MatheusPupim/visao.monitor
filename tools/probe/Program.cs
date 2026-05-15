using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

// Probe — sonda 4 endpoints da VisaoApi e atualiza data/status.json.
// TODAS as credenciais e detalhes da API vem de variaveis de ambiente.
// Nada hardcoded — se faltar env var, falha com exit code != 0.

CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;

string Req(string name)
{
    var v = Environment.GetEnvironmentVariable(name);
    if (string.IsNullOrWhiteSpace(v))
    {
        Console.Error.WriteLine($"ENV missing: {name}. Configure como GitHub Secret/Variable.");
        Environment.Exit(2);
    }
    return v!;
}

var apiBase = Req("VISAO_API_BASE").TrimEnd('/');
var cnpjTeste = Req("CNPJ_TESTE");
var tokenRelease = Req("TOKEN_RELEASE");
// Formula do token padrao (substitui {day} pelo dia atual) e BCrypt.
var tokenSigFormula = Req("TOKEN_SIG_FORMULA");
// Token Acessos: texto literal que vira BCrypt em runtime.
var tokenAceLiteral = Req("TOKEN_ACE_LITERAL");

var outputFile = Environment.GetEnvironmentVariable("OUTPUT_FILE") ?? "../../data/status.json";
var maxRows = int.TryParse(Environment.GetEnvironmentVariable("MAX_ROWS"), out var m) ? m : 200;
var timeoutSec = int.TryParse(Environment.GetEnvironmentVariable("CONNECT_TIMEOUT_SEC"), out var t) ? t : 60;

// BCrypts gerados em runtime — nunca persistidos.
var diaHoje = DateTime.UtcNow.AddHours(-3).Day;
var tokenSigecom = BCrypt.Net.BCrypt.HashPassword(tokenSigFormula.Replace("{day}", diaHoje.ToString()));
var tokenAcessos = BCrypt.Net.BCrypt.HashPassword(tokenAceLiteral);

using var http = new HttpClient(new HttpClientHandler
{
    ServerCertificateCustomValidationCallback = (_, _, _, _) => true,
    AutomaticDecompression = DecompressionMethods.All
})
{
    Timeout = TimeSpan.FromSeconds(timeoutSec)
};

async Task<(double seconds, int httpCode)> Probe(string method, string path, string? token, string? jsonBody)
{
    var sw = Stopwatch.StartNew();
    try
    {
        using var req = new HttpRequestMessage(new HttpMethod(method), apiBase + path);
        if (token is not null) req.Headers.Add("token", token);
        if (jsonBody is not null) req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        using var resp = await http.SendAsync(req);
        sw.Stop();
        await resp.Content.ReadAsByteArrayAsync();
        return (sw.Elapsed.TotalSeconds, (int)resp.StatusCode);
    }
    catch (TaskCanceledException)
    {
        sw.Stop();
        return (sw.Elapsed.TotalSeconds, 0);
    }
    catch (HttpRequestException)
    {
        sw.Stop();
        return (sw.Elapsed.TotalSeconds, 0);
    }
}

var healthTask = Probe("GET", "/health/ready", null, null);
var releaseTask = Probe("GET", "/visaoapi/v3/sigecom/release?quantidade=10&sigecomAntigo=true", tokenRelease, null);
var acessosTask = Probe("GET", $"/visaoapi/v3/acessos?cnpj={cnpjTeste}&quantidadeResultados=10", tokenAcessos, null);
var v4Body = $"{{\"Cnpj\":\"{cnpjTeste}\",\"NumeroVersaoExeSistema\":\"6.0.0.0\",\"NomeUsuario\":\"monitor\",\"Ip\":\"127.0.0.1\"}}";
var v4Task = Probe("POST", "/visaoapi/v4/cobranca/licencas/verificar", tokenSigecom, v4Body);

await Task.WhenAll(healthTask, releaseTask, acessosTask, v4Task);

var (hT, hC) = healthTask.Result;
var (rT, rC) = releaseTask.Result;
var (aT, aC) = acessosTask.Result;
var (vT, vC) = v4Task.Result;

bool Vivo(int code) => code >= 200 && code < 500;

string Status()
{
    if (!Vivo(hC) || !Vivo(rC) || !Vivo(aC) || !Vivo(vC)) return "THANOS";
    if (hT > 30 || rT > 30 || aT > 30 || vT > 60) return "THANOS";
    if (hT > 10 || rT > 10 || aT > 10 || vT > 10) return "ALERTA";
    return "OK";
}

var status = Status();
var nowUtc = DateTime.UtcNow;
var nowBr = nowUtc.AddHours(-3);
var entry = new JsonObject
{
    ["ts"] = nowBr.ToString("yyyy-MM-dd HH:mm:ss"),
    ["tsUtc"] = nowUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"),
    ["status"] = status,
    ["h"] = Math.Round(hT, 3), ["hc"] = hC,
    ["r"] = Math.Round(rT, 3), ["rc"] = rC,
    ["a"] = Math.Round(aT, 3), ["ac"] = aC,
    ["v"] = Math.Round(vT, 3), ["vc"] = vC,
};

JsonArray rows;
JsonObject root;
var outputFullPath = Path.GetFullPath(outputFile);
if (File.Exists(outputFullPath))
{
    try
    {
        var existing = JsonNode.Parse(File.ReadAllText(outputFullPath))?.AsObject() ?? new JsonObject();
        root = existing;
        rows = (root["rows"] as JsonArray) ?? new JsonArray();
    }
    catch
    {
        root = new JsonObject();
        rows = new JsonArray();
    }
}
else
{
    root = new JsonObject();
    rows = new JsonArray();
}

rows.Add(entry);

while (rows.Count > maxRows)
    rows.RemoveAt(0);

root["generatedAt"] = nowUtc.ToString("yyyy-MM-ddTHH:mm:ssZ");
root["generatedAtBr"] = nowBr.ToString("yyyy-MM-dd HH:mm:ss");
root["lastStatus"] = status;
root["rows"] = rows;

var outDir = Path.GetDirectoryName(outputFullPath);
if (!string.IsNullOrEmpty(outDir)) Directory.CreateDirectory(outDir);

var opts = new JsonSerializerOptions { WriteIndented = false };
File.WriteAllText(outputFullPath, root.ToJsonString(opts), new UTF8Encoding(false));

Console.WriteLine($"[{nowBr:yyyy-MM-dd HH:mm:ss}] {status} | h={hT:F2}s/{hC} r={rT:F2}s/{rC} a={aT:F2}s/{aC} v4={vT:F2}s/{vC}");
Console.WriteLine($"wrote {outputFullPath} ({rows.Count} rows)");
return 0;
