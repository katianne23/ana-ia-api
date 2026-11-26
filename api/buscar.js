
const { google } = require('googleapis');

// ==========================================
// CONFIGURAÇÃO DAS PLANILHAS
// ==========================================

// São Paulo
const PLANILHA_SP_ID = "1p_fGcdYYxBZaud8sBS78WuagB057OB1Xv34Lkc94V7E";
const ABA_SP_GID = 116363705;

// RJ e grupo de estados
const PLANILHA_RJ_ID = "1xCxEIRZN1kP-BEUhSJAByArvjEYMk1R4NTAdxuNElmc";
const ABA_RJ_GID = 2116486440;

// Demais regiões
const PLANILHA_DEMAIS_ID = "1-8h0tJTFIymP6NPCfAIGDs40YkJ_DSHoCe6xJE03xXA";
const ABA_DEMAIS_GID = 506062902;

// Contatos
const PLANILHA_CONTATOS_ID = "1Mp_G0e8ZlN-ofQZX0w-wZSUuQgTtuzCHlk7i6HfsiJ4";
const ABA_CONTATOS_GID = 1846076689;

// ==========================================
// CONFIGURAÇÃO GOOGLE
// ==========================================

async function conectarGoogle() {
  const credentials = JSON.parse(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly"
    ]
  });

  return google.sheets({
    version: "v4",
    auth
  });
}

// ==========================================
// NORMALIZAÇÃO DE TEXTO
// ==========================================

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// FORMATAÇÃO CORRETA DE PREÇO
// ==========================================

function converterPreco(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  // Se o Google retornar um número, ele já representa
  // o valor numérico real da célula.
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    return valor;
  }

  let texto = String(valor)
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");

  if (!texto) return null;

  // Padrão americano: 1,057.60
  // Remove vírgula de milhar e mantém ponto decimal.
  if (/^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(texto)) {
    texto = texto.replace(/,/g, "");
  }
  // Padrão brasileiro: 1.057,60
  else if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  }
  // Decimal com ponto: 236.91
  else if (/^-?\d+\.\d{1,2}$/.test(texto)) {
    // Mantém o ponto como separador decimal.
  }
  // Decimal com vírgula: 236,91
  else if (/^-?\d+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(",", ".");
  }
  // Inteiro sem separador
  else if (/^-?\d+$/.test(texto)) {
    // Mantém o número inteiro.
  } else {
    return null;
  }

  const numero = Number(texto);

  return Number.isFinite(numero) ? numero : null;
}

function formatarPreco(valor) {
  const numero = converterPreco(valor);

  if (numero === null) {
    throw new Error("Preço inválido na planilha");
  }

  return numero.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// ==========================================
// IDENTIFICAR ABA PELO GID
// ==========================================

async function obterNomeAba(sheets, spreadsheetId, gid) {
  const resposta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties"
  });

  const aba = resposta.data.sheets.find(
    item => Number(item.properties.sheetId) === Number(gid)
  );

  if (!aba) {
    throw new Error(`Aba com GID ${gid} não encontrada.`);
  }

  return aba.properties.title;
}

// ==========================================
// LER DADOS DA PLANILHA
// ==========================================

async function lerPlanilha(sheets, spreadsheetId, gid) {
  const nomeAba = await obterNomeAba(
    sheets,
    spreadsheetId,
    gid
  );

  const intervalo = `'${nomeAba.replace(/'/g, "''")}'!A:Z`;

  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: intervalo,
    valueRenderOption: "UNFORMATTED_VALUE"
  });

  return resposta.data.values || [];
}

// ==========================================
// VALIDAR CNPJ
// ==========================================

function limparCNPJ(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

async function validarCNPJ(sheets, cnpj) {
  const cnpjLimpo = limparCNPJ(cnpj);

  if (cnpjLimpo.length !== 14) {
    return false;
  }

  const linhas = await lerPlanilha(
    sheets,
    PLANILHA_CONTATOS_ID,
    ABA_CONTATOS_GID
  );

  return linhas.some((linha, indice) => {
    if (indice === 0) return false;

    return linha.some(celula =>
      limparCNPJ(celula) === cnpjLimpo
    );
  });
}

// ==========================================
// IDENTIFICAR REGIÃO PELO DDD
// ==========================================

function obterDDD(telefone) {
  let numero = String(telefone || "").replace(/\D/g, "");

  if (numero.startsWith("55") && numero.length >= 12) {
    numero = numero.substring(2);
  }

  if (numero.length < 10) {
    return null;
  }

  return numero.substring(0, 2);
}

function obterPlanilhaPorDDD(ddd) {
  const dddsSP = [
    "11", "12", "13", "14", "15",
    "16", "17", "18", "19"
  ];

  const dddsRJ = [
    "21", "22", "24",
    "31", "32", "33", "34", "35", "37", "38",
    "41", "42", "43", "44", "45", "46",
    "47", "48", "49",
    "51", "53", "54", "55"
  ];

  if (dddsSP.includes(ddd)) {
    return {
      id: PLANILHA_SP_ID,
      gid: ABA_SP_GID
    };
  }

  if (dddsRJ.includes(ddd)) {
    return {
      id: PLANILHA_RJ_ID,
      gid: ABA_RJ_GID
    };
  }

  return {
    id: PLANILHA_DEMAIS_ID,
    gid: ABA_DEMAIS_GID
  };
}

// ==========================================
// BUSCA DO PRODUTO
// ==========================================

function buscarProduto(linhas, produtoInformado) {
  const busca = normalizarTexto(produtoInformado);

  if (!busca) return null;

  // Ignora cabeçalho.
  const dados = linhas.slice(1);

  // A = Referência
  // B = Nome
  // F = Preço
  // G = Palavras-chave

  // 1. Busca por referência exata
  let encontrado = dados.find(linha =>
    normalizarTexto(linha[0]) === busca
  );

  // 2. Busca por nome exato
  if (!encontrado) {
    encontrado = dados.find(linha =>
      normalizarTexto(linha[1]) === busca
    );
  }

  // 3. Busca por palavra-chave exata
  if (!encontrado) {
    encontrado = dados.find(linha => {
      const palavras = String(linha[6] || "")
        .split(/[;,|]/)
        .map(item => normalizarTexto(item));

      return palavras.includes(busca);
    });
  }

  if (!encontrado) return null;

  return {
    referencia: encontrado[0] || "",
    produto: encontrado[1] || "",
    precoOriginal: encontrado[5],
    ipi: encontrado[7] || encontrado[8] || "5,2%"
  };
}

// ==========================================
// RESPOSTA DA API
// ==========================================

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      success: false,
      message: "Método não permitido. Utilize GET."
    });
  }

  try {
    const produto = String(req.query.produto || "").trim();
    const telefone = String(req.query.telefone || "").trim();
    const cnpj = String(req.query.cnpj || "").trim();

    if (!produto || !telefone || !cnpj) {
      return res.status(400).json({
        status: "error",
        success: false,
        message: "Informe produto, telefone e CNPJ."
      });
    }

    const sheets = await conectarGoogle();

    // 1. Validar CNPJ
    const cnpjValido = await validarCNPJ(sheets, cnpj);

    if (!cnpjValido) {
      return res.status(200).json({
        status: "cnpj_invalido",
        success: false,
        message: "CNPJ não encontrado no cadastro de clientes."
      });
    }

    // 2. Identificar DDD
    const ddd = obterDDD(telefone);

    if (!ddd) {
      return res.status(200).json({
        status: "error",
        success: false,
        message: "Telefone inválido ou sem DDD."
      });
    }

    // 3. Selecionar planilha regional
    const planilha = obterPlanilhaPorDDD(ddd);

    // 4. Consultar produtos
    const linhas = await lerPlanilha(
      sheets,
      planilha.id,
      planilha.gid
    );

    const resultado = buscarProduto(linhas, produto);

    if (!resultado) {
      return res.status(200).json({
        status: "not_found",
        success: false,
        produto: produto,
        ddd: ddd,
        message: `Não localizei o produto: ${produto}.`
      });
    }

    // 5. Converter e formatar preço
    const precoFormatado = formatarPreco(
      resultado.precoOriginal
    );

    // 6. Montar resposta
    const message =
      `${resultado.produto} (ref. ${resultado.referencia}): ` +
      `R$ ${precoFormatado} + ${resultado.ipi} de IPI.`;

    return res.status(200).json({
      status: "success",
      success: true,
      produto: resultado.produto,
      referencia: String(resultado.referencia),
      preco: precoFormatado,
      ipi: resultado.ipi,
      ddd: ddd,
      message: message
    });

  } catch (erro) {
    console.error("ERRO NA API BUSCAR:", erro.message);

    return res.status(500).json({
      status: "error",
      success: false,
      message: "Ocorreu um erro ao consultar o produto. Encaminhe para atendimento humano."
    });
  }
};
