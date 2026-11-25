// api/buscar.js
const { google } = require('googleapis');

const PLANILHA_SP_ID = "1p_fGcdYYxBZaud8sBS78WuagB057OB1Xv34Lkc94V7E";
const ABA_SP_GID = 116363705;
const PLANILHA_RJ_ID = "1xCxEIRZN1kP-BEUhSJAByArvjEYMk1R4NTAdxuNElmc";
const ABA_RJ_GID = 2116486440;
const PLANILHA_DEMAIS_ID = "1-8h0tJTFIymP6NPCfAIGDs40YkJ_DSHoCe6xJE03xXA";
const ABA_DEMAIS_GID = 506062902;
const PLANILHA_CONTATOS_ID = "1Mp_G0e8ZlN-ofQZX0w-wZSUuQgTtuzCHlk7i6HfsiJ4";
const ABA_CONTATOS_GID = 1846076689;

function normalizarTexto(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

async function getSheetName(sheets, spreadsheetId, gid) {
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets.find(s => s.properties.sheetId == gid);
  return sheet ? sheet.properties.title : res.data.sheets[0].properties.title;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { produto, telefone, cnpj } = req.body;
  const termoBusca = String(produto || "").trim();
  const telLimpo = String(telefone || "").trim();
  const cnpjLimpoOriginal = String(cnpj || "").trim();

  if (!termoBusca) return res.status(400).json({ status: "error", message: "Nenhum produto informado." });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // 1. Validação do CNPJ
    if (cnpjLimpoOriginal) {
      const cnpjLimpo = cnpjLimpoOriginal.replace(/\D/g, "");
      if (cnpjLimpo.length !== 14) return res.status(200).json({ status: "cnpj_invalido", message: "CNPJ inválido." });
      
      const nomeAbaContatos = await getSheetName(sheets, PLANILHA_CONTATOS_ID, ABA_CONTATOS_GID);
      const respContatos = await sheets.spreadsheets.values.get({ spreadsheetId: PLANILHA_CONTATOS_ID, range: `${nomeAbaContatos}!A:Z` });
      const rowsContatos = respContatos.data.values || [];
      
      let cnpjEncontrado = false;
      for (const row of rowsContatos) {
        for (const cell of row) {
          if (String(cell).replace(/\D/g, "") === cnpjLimpo) { cnpjEncontrado = true; break; }
        }
        if (cnpjEncontrado) break;
      }
      if (!cnpjEncontrado) return res.status(200).json({ status: "cnpj_invalido", message: "CNPJ não encontrado na base." });
    }

    // 2. Identificar DDD
    let ddd = "";
    if (telLimpo) {
      let numLimpo = telLimpo.replace(/\D/g, "");
      if (numLimpo.startsWith("55") && numLimpo.length >= 12) numLimpo = numLimpo.substring(2);
      if (numLimpo.length >= 10) ddd = numLimpo.substring(0, 2);
    }

    const dddSP = ["11", "12", "13", "14", "15", "16", "17", "18", "19"];
    const dddRJ = ["21", "22", "24", "31", "32", "33", "34", "35", "36", "37", "38", "41", "42", "43", "44", "45", "46", "47", "48", "49", "51", "53", "54", "55"];

    let idPlanilha, gidAba;
    if (dddSP.includes(ddd)) { idPlanilha = PLANILHA_SP_ID; gidAba = ABA_SP_GID; }
    else if (dddRJ.includes(ddd)) { idPlanilha = PLANILHA_RJ_ID; gidAba = ABA_RJ_GID; }
    else { idPlanilha = PLANILHA_DEMAIS_ID; gidAba = ABA_DEMAIS_GID; }

    // 3. Buscar Produtos
    const nomeAbaPrecos = await getSheetName(sheets, idPlanilha, gidAba);
    const respPrecos = await sheets.spreadsheets.values.get({ spreadsheetId: idPlanilha, range: `${nomeAbaPrecos}!A:Z` });
    const dadosPrecos = respPrecos.data.values || [];
    
    const produtos = [];
    const buscaNormalizada = normalizarTexto(termoBusca);
    const tokensBusca = buscaNormalizada.split(" ").filter(Boolean);

    for (let i = 1; i < dadosPrecos.length; i++) {
      const row = dadosPrecos[i];
      const ref = String(row[0] || "").trim();
      const produtoNome = String(row[1] || "").trim();
      const valorFinal = String(row[5] || "").trim();
      const palavrasChave = String(row[6] || "").trim();

      if (!ref || !produtoNome || !valorFinal) continue;
      const precoNumerico = Number(valorFinal.replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(?:,|$))/g, "").replace(",", "."));
      if (!Number.isFinite(precoNumerico) || precoNumerico <= 0) continue;

      produtos.push({ ref, nome: produtoNome, nomeNormalizado: normalizarTexto(produtoNome), preco: valorFinal, keywords: palavrasChave.split(",").map(k => normalizarTexto(k)).filter(Boolean) });
    }

    // 4. Lógica de Busca
    const respostaProduto = (p) => ({ status: "success", message: `${p.nome} (ref. ${p.ref}): R$ ${p.preco} + 5,2% de IPI.` });

    const pRef = produtos.find(p => p.ref.toUpperCase() === termoBusca.toUpperCase());
    if (pRef) return res.status(200).json(respostaProduto(pRef));

    const pNome = produtos.filter(p => p.nomeNormalizado === buscaNormalizada);
    if (pNome.length === 1) return res.status(200).json(respostaProduto(pNome[0]));
    if (pNome.length > 1) return res.status(200).json({ status: "not_found", message: `Mais de um produto. Informe a referência.` });

    const pKey = produtos.filter(p => p.keywords.includes(buscaNormalizada));
    if (pKey.length === 1) return res.status(200).json(respostaProduto(pKey[0]));

    return res.status(200).json({ status: "not_found", message: `Não localizei o item: ${termoBusca}` });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ status: "error", message: "Erro interno no servidor de preços." });
  }
}