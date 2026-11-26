
const { google } = require('googleapis');

// ==========================================
// CONFIGURAÇÃO DAS PLANILHAS
// ==========================================

const PLANILHA_SP_ID = "1p_fGcdYYxBZaud8sBS78WuagB057OB1Xv34Lkc94V7E";
const ABA_SP_GID = 116363705;

const PLANILHA_RJ_ID = "1xCxEIRZN1kP-BEUhSJAByArvjEYMk1R4NTAdxuNElmc";
const ABA_RJ_GID = 2116486440;

const PLANILHA_DEMAIS_ID = "1-8h0tJTFIymP6NPCfAIGDs40YkJ_DSHoCe6xJE03xXA";
const ABA_DEMAIS_GID = 506062902;

const PLANILHA_CONTATOS_ID = "1Mp_G0e8ZlN-ofQZX0w-wZSUuQgTtuzCHlk7i6HfsiJ4";
const ABA_CONTATOS_GID = 1846076689;

// IPI padrão
const IPI_PADRAO = "5,2%";

// ==========================================
// CONFIGURAÇÃO GOOGLE
// ==========================================

async function conectarGoogle() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error("Credencial Google não configurada.");
  }

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
// NORMALIZAÇÃO
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

// Palavras que não ajudam a identificar o produto.
const PALAVRAS_IGNORADAS = new Set([
  "QUERO", "COTAR", "COTACAO", "PRECISO",
  "DE", "DO", "DA", "DOS", "DAS",
  "O", "A", "OS", "AS", "UM", "UMA",
  "COM", "PARA", "POR", "EM", "NO", "NA",
  "NOS", "NAS", "E", "OU", "ME", "ENVIE",
  "INFORME", "PRODUTO", "ITEM", "ITENS",
  "REFERENCIA", "REF", "CODIGO",
  "UN", "UND", "UNIDADE", "UNIDADES"
]);

function obterTokens(texto) {
  return normalizarTexto(texto)
    .split(" ")
    .filter(token =>
      token.length > 0 &&
      !PALAVRAS_IGNORADAS.has(token)
    );
}

// ==========================================
// IDENTIFICAR MEDIDAS
// ==========================================

function extrairMedidas(texto) {
  const original = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const medidas = new Set();

  // Exemplo: 35 X 10 MM
  const dimensoes =
    original.match(
      /\b\d+(?:[.,]\d+)?\s*[X×]\s*\d+(?:[.,]\d+)?\s*(?:MM|CM|M)\b/g
    ) || [];

  dimensoes.forEach(item => {
    const medida = item
      .replace(/\s+/g, "")
      .replace("×", "X")
      .replace(",", ".");

    medidas.add(medida);
  });

  // Exemplo: 27 CM, 4 MM, 0,80 CM
  const individuais =
    original.match(
      /\b\d+(?:[.,]\d+)?\s*(?:MM|CM|M)\b/g
    ) || [];

  individuais.forEach(item => {
    const medida = item
      .replace(/\s+/g, "")
      .replace(",", ".");

    medidas.add(medida);
  });

  return [...medidas];
}

function medidasCompativeis(busca, candidato) {
  const medidasBusca = extrairMedidas(busca);
  const medidasCandidato = extrairMedidas(candidato);

  if (medidasBusca.length === 0) {
    return true;
  }

  if (medidasCandidato.length === 0) {
    return false;
  }

  return medidasBusca.every(medida =>
    medidasCandidato.includes(medida)
  );
}

// ==========================================
// FORMATAÇÃO DE PREÇO
// ==========================================

function converterPreco(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }

  let texto = String(valor)
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");

  if (!texto) return null;

  // Formato americano: 1,057.60
  if (/^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(texto)) {
    texto = texto.replace(/,/g, "");
  }

  // Formato brasileiro: 1.057,60
  else if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  }

  // Decimal com ponto
  else if (/^-?\d+\.\d{1,2}$/.test(texto)) {
    // Mantém o ponto.
  }

  // Decimal com vírgula
  else if (/^-?\d+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(",", ".");
  }

  // Inteiro
  else if (/^-?\d+$/.test(texto)) {
    // Mantém o número.
  }

  else {
    return null;
  }

  const numero = Number(texto);

  return Number.isFinite(numero) ? numero : null;
}

function formatarPreco(valor) {
  const numero = converterPreco(valor);

  if (numero === null) {
    throw new Error("Preço inválido na planilha.");
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

  const abas = resposta.data.sheets || [];

  const aba = abas.find(item =>
    Number(item.properties.sheetId) === Number(gid)
  );

  if (!aba) {
    throw new Error(`Aba com GID ${gid} não encontrada.`);
  }

  return aba.properties.title;
}

// ==========================================
// LER PLANILHA
// ==========================================

async function lerPlanilha(sheets, spreadsheetId, gid) {
  const nomeAba = await obterNomeAba(
    sheets,
    spreadsheetId,
    gid
  );

  const intervalo =
    `'${nomeAba.replace(/'/g, "''")}'!A:Z`;

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
// IDENTIFICAR DDD
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
// MONTAR PRODUTO
// ==========================================

function montarProduto(linha) {
  return {
    referencia: String(linha[0] || "").trim(),
    produto: String(linha[1] || "").trim(),
    precoOriginal: linha[5],
    palavrasChave: String(linha[6] || "").trim()
  };
}

function chaveProduto(produto) {
  return `${produto.referencia}|${normalizarTexto(produto.produto)}`;
}

// ==========================================
// PONTUAÇÃO DE SIMILARIDADE
// ==========================================

function calcularSimilaridade(busca, candidato) {
  const tokensBusca = [...new Set(obterTokens(busca))];

  const tokensNome = [...new Set(obterTokens(candidato.produto))];

  const tokensCatalogo = [
    ...new Set(
      obterTokens(
        `${candidato.produto} ${candidato.palavrasChave}`
      )
    )
  ];

  if (tokensBusca.length === 0 || tokensCatalogo.length === 0) {
    return {
      score: 0,
      correspondencias: 0
    };
  }

  const conjuntoCatalogo = new Set(tokensCatalogo);

  const correspondentes = tokensBusca.filter(token =>
    conjuntoCatalogo.has(token)
  );

  const correspondencias = correspondentes.length;

  const cobertura =
    correspondencias / tokensBusca.length;

  const intersecao =
    correspondencias;

  const uniao =
    new Set([...tokensBusca, ...tokensCatalogo]).size;

  const jaccard =
    uniao > 0 ? intersecao / uniao : 0;

  const conjuntoNome = new Set(tokensNome);

  const correspondenciasNome =
    tokensBusca.filter(token =>
      conjuntoNome.has(token)
    ).length;

  const coberturaNome =
    correspondenciasNome / tokensBusca.length;

  // A identificação pelo nome principal tem peso maior.
  const score =
    (cobertura * 0.65) +
    (jaccard * 0.20) +
    (coberturaNome * 0.15);

  return {
    score,
    correspondencias
  };
}

// ==========================================
// BUSCA DE PRODUTOS
// ==========================================

function buscarProduto(linhas, produtoInformado) {
  const busca = normalizarTexto(produtoInformado);

  if (!busca) {
    return {
      tipo: "nao_encontrado"
    };
  }

  const dados = linhas.slice(1);

  const produtos = dados
    .filter(linha => linha[0] || linha[1])
    .map(montarProduto);

  // ----------------------------------------
  // 1. REFERÊNCIA EXATA
  // ----------------------------------------

  const porReferencia = produtos.filter(item =>
    normalizarTexto(item.referencia) === busca
  );

  if (porReferencia.length === 1) {
    return {
      tipo: "encontrado",
      produto: porReferencia[0]
    };
  }

  if (porReferencia.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: porReferencia.slice(0, 5)
    };
  }

  // ----------------------------------------
  // 2. NOME EXATO
  // ----------------------------------------

  const porNome = produtos.filter(item =>
    normalizarTexto(item.produto) === busca
  );

  if (porNome.length === 1) {
    return {
      tipo: "encontrado",
      produto: porNome[0]
    };
  }

  if (porNome.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: porNome.slice(0, 5)
    };
  }

  // ----------------------------------------
  // 3. PALAVRA-CHAVE EXATA
  // ----------------------------------------

  const porPalavraChave = produtos.filter(item => {
    const palavras = item.palavrasChave
      .split(/[;,|]/)
      .map(palavra => normalizarTexto(palavra))
      .filter(Boolean);

    return palavras.includes(busca);
  });

  if (porPalavraChave.length === 1) {
    return {
      tipo: "encontrado",
      produto: porPalavraChave[0]
    };
  }

  if (porPalavraChave.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: porPalavraChave.slice(0, 5)
    };
  }

  // ----------------------------------------
  // 4. BUSCA POR SIMILARIDADE
  // ----------------------------------------

  const candidatos = produtos.map(item => {
    const similaridade = calcularSimilaridade(
      produtoInformado,
      item
    );

    const textoCatalogo =
      `${item.produto} ${item.palavrasChave}`;

    const medidasOK = medidasCompativeis(
      produtoInformado,
      textoCatalogo
    );

    return {
      ...item,
      score: similaridade.score,
      correspondencias: similaridade.correspondencias,
      medidasOK
    };
  });

  candidatos.sort((a, b) => b.score - a.score);

  // Considera candidatos com correspondência relevante.
  const relevantes = candidatos.filter(item =>
    item.score >= 0.30 &&
    item.correspondencias >= 1
  );

  if (relevantes.length === 0) {
    return {
      tipo: "nao_encontrado"
    };
  }

  const melhor = relevantes[0];
  const segundo = relevantes[1];

  // ----------------------------------------
  // 5. RESULTADO COM ALTA CONFIANÇA
  // ----------------------------------------

  const diferenca =
    segundo ? melhor.score - segundo.score : 1;

  const quantidadeTokens =
    obterTokens(produtoInformado).length;

  const altaConfianca =
    melhor.score >= 0.90 &&
    melhor.medidasOK &&
    quantidadeTokens >= 2 &&
    diferenca >= 0.15;

  if (altaConfianca) {
    return {
      tipo: "encontrado",
      produto: melhor
    };
  }

  // ----------------------------------------
  // 6. MÚLTIPLAS POSSIBILIDADES
  // ----------------------------------------

  // Não entrega preço em correspondências aproximadas
  // que precisam de confirmação do cliente.

  return {
    tipo: "ambiguo",
    candidatos: relevantes.slice(0, 5).map(item => ({
      referencia: item.referencia,
      produto: item.produto,
      score: Number(item.score.toFixed(3)),
      medidasCompativeis: item.medidasOK
    }))
  };
}

// ==========================================
// RESPOSTA DA API
// ==========================================

module.exports = async (req, res) => {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

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

    // 1. Validar CNPJ cadastrado.
    const cnpjValido = await validarCNPJ(sheets, cnpj);

    if (!cnpjValido) {
      return res.status(200).json({
        status: "cnpj_invalido",
        success: false,
        message: "CNPJ não encontrado no cadastro de clientes."
      });
    }

    // 2. Identificar DDD pelo telefone.
    const ddd = obterDDD(telefone);

    if (!ddd) {
      return res.status(200).json({
        status: "error",
        success: false,
        message: "Telefone inválido ou sem DDD."
      });
    }

    // 3. Selecionar planilha regional.
    const planilha = obterPlanilhaPorDDD(ddd);

    // 4. Ler dados.
    const linhas = await lerPlanilha(
      sheets,
      planilha.id,
      planilha.gid
    );

    // 5. Buscar produto.
    const resultado = buscarProduto(
      linhas,
      produto
    );

    // --------------------------------------
    // PRODUTO NÃO ENCONTRADO
    // --------------------------------------

    if (resultado.tipo === "nao_encontrado") {
      return res.status(200).json({
        status: "not_found",
        success: false,
        produto,
        ddd,
        message: `Não localizei o produto: ${produto}.`
      });
    }

    // --------------------------------------
    // MAIS DE UMA POSSIBILIDADE
    // --------------------------------------

    if (resultado.tipo === "ambiguo") {
      return res.status(200).json({
        status: "multiple_matches",
        success: false,
        produto_solicitado: produto,
        ddd,
        candidatos: resultado.candidatos.map(item => ({
          referencia: item.referencia,
          produto: item.produto,
          medidas_compativeis: item.medidasCompativeis
        })),
        message:
          "Encontrei possíveis produtos correspondentes, mas preciso confirmar a variação correta antes de informar o preço."
      });
    }

    // --------------------------------------
    // PRODUTO ENCONTRADO
    // --------------------------------------

    const produtoEncontrado = resultado.produto;

    // 6. Converter preço.
    const precoFormatado = formatarPreco(
      produtoEncontrado.precoOriginal
    );

    // 7. IPI fixo.
    const ipi = IPI_PADRAO;

    // 8. Montar resposta.
    const message =
      `${produtoEncontrado.produto} ` +
      `(ref. ${produtoEncontrado.referencia}): ` +
      `R$ ${precoFormatado} + ${ipi} de IPI.`;

    return res.status(200).json({
      status: "success",
      success: true,
      produto: produtoEncontrado.produto,
      referencia: String(produtoEncontrado.referencia),
      preco: precoFormatado,
      ipi,
      ddd,
      message
    });

  } catch (erro) {
    console.error(
      "ERRO NA API BUSCAR:",
      erro.message
    );

    return res.status(500).json({
      status: "error",
      success: false,
      message:
        "Ocorreu um erro ao consultar o produto. Encaminhe para atendimento humano."
    });
  }
};
