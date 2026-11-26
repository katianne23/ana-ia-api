
const { google } = require("googleapis");

// ==========================================
// CONFIGURAÇÃO DAS PLANILHAS
// ==========================================

// São Paulo
const PLANILHA_SP_ID =
  "1p_fGcdYYxBZaud8sBS78WuagB057OB1Xv34Lkc94V7E";
const ABA_SP_GID = 116363705;

// Rio de Janeiro e grupo de estados
const PLANILHA_RJ_ID =
  "1xCxEIRZN1kP-BEUhSJAByArvjEYMk1R4NTAdxuNElmc";
const ABA_RJ_GID = 2116486440;

// Demais regiões
const PLANILHA_DEMAIS_ID =
  "1-8h0tJTFIymP6NPCfAIGDs40YkJ_DSHoCe6xJE03xXA";
const ABA_DEMAIS_GID = 506062902;

// Contatos — ID atualizado
const PLANILHA_CONTATOS_ID =
  "1Mp_G0e8ZlN-ofQZX0w-wZSUuQgTtuzCHlk7i6HfsiJ4";
const ABA_CONTATOS_GID = 1846076689;

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function somenteNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function jsonResponse(res, statusCode, data) {
  return res.status(statusCode).json(data);
}

// Localiza o nome da aba pelo GID
async function getSheetName(sheets, spreadsheetId, gid) {
  const resposta = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const abas = resposta.data.sheets || [];

  const aba = abas.find(
    (item) => Number(item.properties.sheetId) === Number(gid)
  );

  if (!aba) {
    throw new Error(
      `A aba com GID ${gid} não foi encontrada na planilha ${spreadsheetId}.`
    );
  }

  return aba.properties.title;
}

// Lê os dados de uma aba
async function lerPlanilha(sheets, spreadsheetId, gid) {
  const nomeAba = await getSheetName(
    sheets,
    spreadsheetId,
    gid
  );

  const nomeAbaEscapado = nomeAba.replace(/'/g, "''");

  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${nomeAbaEscapado}'!A:Z`,
  });

  return resposta.data.values || [];
}

// ==========================================
// VALIDAÇÃO DO CNPJ
// ==========================================

async function validarCNPJ(sheets, cnpj) {
  const cnpjLimpo = somenteNumeros(cnpj);

  if (cnpjLimpo.length !== 14) {
    return false;
  }

  const contatos = await lerPlanilha(
    sheets,
    PLANILHA_CONTATOS_ID,
    ABA_CONTATOS_GID
  );

  // Procura o CNPJ nas células da planilha de contatos.
  // A primeira linha é considerada cabeçalho.
  for (let i = 1; i < contatos.length; i++) {
    const linha = contatos[i] || [];

    for (const celula of linha) {
      if (somenteNumeros(celula) === cnpjLimpo) {
        return true;
      }
    }
  }

  return false;
}

// ==========================================
// IDENTIFICAÇÃO DO DDD
// ==========================================

function obterDDD(telefone) {
  let numero = somenteNumeros(telefone);

  // Remove o código do Brasil, quando presente
  if (
    numero.startsWith("55") &&
    (numero.length === 12 || numero.length === 13)
  ) {
    numero = numero.substring(2);
  }

  if (numero.length < 10) {
    return null;
  }

  return numero.substring(0, 2);
}

// ==========================================
// SELEÇÃO DA PLANILHA POR REGIÃO
// ==========================================

function selecionarPlanilha(ddd) {
  const numeroDDD = Number(ddd);

  // São Paulo: DDD 11 a 19
  if (numeroDDD >= 11 && numeroDDD <= 19) {
    return {
      id: PLANILHA_SP_ID,
      gid: ABA_SP_GID,
    };
  }

  // Grupo RJ, PR, MG, RS e SC
  const dddsGrupoRJ = [
    21, 22, 24,
    31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49,
    51, 53, 54, 55,
  ];

  if (dddsGrupoRJ.includes(numeroDDD)) {
    return {
      id: PLANILHA_RJ_ID,
      gid: ABA_RJ_GID,
    };
  }

  // Demais regiões
  return {
    id: PLANILHA_DEMAIS_ID,
    gid: ABA_DEMAIS_GID,
  };
}

// ==========================================
// FORMATAÇÃO DO PREÇO
// ==========================================

function formatarPreco(valor) {
  if (valor === null || valor === undefined) {
    return "";
  }

  const texto = String(valor).trim();

  if (!texto) {
    return "";
  }

  // Se já estiver formatado como moeda, preserva o conteúdo
  if (/R\$\s*/i.test(texto)) {
    return texto.replace(/\s+/g, " ");
  }

  // Formata valores numéricos
  const numero = Number(
    texto.replace(/\./g, "").replace(",", ".")
  );

  if (Number.isFinite(numero)) {
    return numero.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return texto;
}

// ==========================================
// BUSCA DO PRODUTO
// ==========================================

function buscarProduto(linhas, termoBusca) {
  const buscaNormalizada = normalizarTexto(termoBusca);
  const buscaReferencia = String(termoBusca).trim().toUpperCase();

  const produtos = linhas.slice(1).map((linha) => {
    return {
      ref: String(linha[0] || "").trim(),
      nome: String(linha[1] || "").trim(),
      preco: linha[5],
      palavrasChave: String(linha[6] || "").trim(),
    };
  }).filter((produto) => {
    return produto.ref && produto.nome && produto.preco !== undefined;
  });

  // 1. Busca por referência exata
  let encontrado = produtos.find((produto) => {
    return produto.ref.toUpperCase() === buscaReferencia;
  });

  if (encontrado) {
    return encontrado;
  }

  // 2. Busca por nome exato
  encontrado = produtos.find((produto) => {
    return normalizarTexto(produto.nome) === buscaNormalizada;
  });

  if (encontrado) {
    return encontrado;
  }

  // 3. Busca por palavra-chave exata
  encontrado = produtos.find((produto) => {
    const palavras = produto.palavrasChave
      .split(/[;,|]/)
      .map((palavra) => normalizarTexto(palavra))
      .filter(Boolean);

    return palavras.includes(buscaNormalizada);
  });

  return encontrado || null;
}

// ==========================================
// ENDPOINT PRINCIPAL — GET
// ==========================================

export default async function handler(req, res) {
  // Aceita somente GET
  if (req.method !== "GET") {
    return jsonResponse(res, 405, {
      status: "error",
      message: "Método não permitido. Utilize GET.",
    });
  }

  // Recebe os parâmetros pela URL
  const produto = Array.isArray(req.query.produto)
    ? req.query.produto[0]
    : req.query.produto;

  const telefone = Array.isArray(req.query.telefone)
    ? req.query.telefone[0]
    : req.query.telefone;

  const cnpj = Array.isArray(req.query.cnpj)
    ? req.query.cnpj[0]
    : req.query.cnpj;

  const termoBusca = String(produto || "").trim();
  const telefoneLimpo = somenteNumeros(telefone);
  const cnpjLimpo = somenteNumeros(cnpj);

  // Verifica se o produto foi informado
  if (!termoBusca) {
    return jsonResponse(res, 400, {
      status: "error",
      message: "Nenhum produto informado.",
    });
  }

  // Verifica telefone
  if (!telefoneLimpo) {
    return jsonResponse(res, 400, {
      status: "error",
      message: "Telefone não informado.",
    });
  }

  // Verifica CNPJ
  if (cnpjLimpo.length !== 14) {
    return jsonResponse(res, 400, {
      status: "cnpj_invalido",
      message: "CNPJ inválido ou não informado.",
    });
  }

  try {
    // Autenticação Google
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error(
        "Variável GOOGLE_SERVICE_ACCOUNT_KEY não configurada na Vercel."
      );
    }

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY
      ),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });

    const sheets = google.sheets({
      version: "v4",
      auth,
    });

    // 1. Valida CNPJ na planilha de contatos
    const cnpjValido = await validarCNPJ(
      sheets,
      cnpjLimpo
    );

    if (!cnpjValido) {
      return jsonResponse(res, 200, {
        status: "cnpj_invalido",
        success: false,
        message: "CNPJ não localizado na base de clientes.",
      });
    }

    // 2. Identifica o DDD
    const ddd = obterDDD(telefoneLimpo);

    if (!ddd) {
      return jsonResponse(res, 400, {
        status: "error",
        message: "Não foi possível identificar o DDD do telefone.",
      });
    }

    // 3. Seleciona a planilha regional
    const planilha = selecionarPlanilha(ddd);

    // 4. Lê os produtos da planilha
    const linhas = await lerPlanilha(
      sheets,
      planilha.id,
      planilha.gid
    );

    // 5. Busca o produto
    const produtoEncontrado = buscarProduto(
      linhas,
      termoBusca
    );

    if (!produtoEncontrado) {
      return jsonResponse(res, 200, {
        status: "not_found",
        success: false,
        message: `Não localizei o produto: ${termoBusca}.`,
      });
    }

    // 6. Valida preço
    const preco = formatarPreco(
      produtoEncontrado.preco
    );

    if (!preco) {
      return jsonResponse(res, 200, {
        status: "error",
        success: false,
        message: "O produto foi localizado, mas não possui preço válido cadastrado.",
      });
    }

    // 7. Retorna resultado
    const mensagem =
      `${produtoEncontrado.nome} (ref. ${produtoEncontrado.ref}): ` +
      `R$ ${preco} + 5,2% de IPI.`;

    return jsonResponse(res, 200, {
      status: "success",
      success: true,
      produto: produtoEncontrado.nome,
      referencia: produtoEncontrado.ref,
      preco: preco,
      ipi: "5,2%",
      ddd: ddd,
      message: mensagem,
    });

  } catch (error) {
    console.error("Erro na API de busca:", error);

    return jsonResponse(res, 500, {
      status: "error",
      success: false,
      message: "Erro interno ao consultar a base de preços.",
      detalhe: error.message,
    });
  }
}
