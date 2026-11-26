
const { google } = require("googleapis");

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
// NORMALIZAÇÃO E SINÔNIMOS
// ==========================================

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[×]/g, " X ")
    .replace(/[^\w\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Padroniza variações de escrita e termos equivalentes.
// Amplie esta lista conforme identificar novas variações
// reais nos pedidos dos clientes.

const SINONIMOS = {
  BACKAUS: "BACKHAUS",
  BACKAUSS: "BACKHAUS",
  BACKHAUSS: "BACKHAUS",

  INOXIDAVEL: "INOX",
  INOXIDAVEIS: "INOX",

  ACOINOX: "INOX",
  AISI: "AISI",

  METZENBAUM: "METZENBAUM",
  METZEMBAUM: "METZENBAUM",

  HISTOMETRO: "HISTEROMETRO",

  COLLIN: "COLLIN",

  YANKAUER: "YANKAUER",
  YANKAUR: "YANKAUER",

  STEIMAN: "STEIMAN",
  STEINMAN: "STEIMAN"
};

const PALAVRAS_IGNORADAS = new Set([
  "QUERO", "COTAR", "COTACAO", "PRECISO",
  "DE", "DO", "DA", "DOS", "DAS",
  "O", "A", "OS", "AS", "UM", "UMA",
  "COM", "PARA", "POR", "EM", "NO", "NA",
  "NOS", "NAS", "E", "OU", "ME", "ENVIE",
  "INFORME", "PRODUTO", "ITEM", "ITENS",
  "REFERENCIA", "REF", "CODIGO",
  "UN", "UND", "UNIDADE", "UNIDADES",
  "QUANTIDADE", "QTD",
  "MATERIAL", "CONFECCIONADO",
  "CONFECCIONADA", "FABRICADO",
  "FABRICADA", "PRODUTO",
  "CAPACIDADE", "FORMATO", "TIPO",
  "APROXIMADAMENTE", "APROX"
]);

function normalizarToken(token) {
  return SINONIMOS[token] || token;
}

function obterTokens(texto) {
  return normalizarTexto(texto)
    .split(" ")
    .map(normalizarToken)
    .filter(token =>
      token.length > 0 &&
      !PALAVRAS_IGNORADAS.has(token) &&
      !/^\d+$/.test(token)
    );
}

// ==========================================
// DISTÂNCIA ENTRE PALAVRAS
// ==========================================

// Permite reconhecer pequenos erros de digitação.
// Exemplo: METZEMBAUM / METZENBAUM.

function distanciaLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matriz = [];

  for (let i = 0; i <= b.length; i++) {
    matriz[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matriz[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const custo = a[j - 1] === b[i - 1] ? 0 : 1;

      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + custo
      );
    }
  }

  return matriz[b.length][a.length];
}

function tokensParecidos(tokenA, tokenB) {
  if (tokenA === tokenB) return true;

  if (tokenA.length < 5 || tokenB.length < 5) {
    return false;
  }

  const distancia = distanciaLevenshtein(tokenA, tokenB);

  if (Math.min(tokenA.length, tokenB.length) >= 9) {
    return distancia <= 2;
  }

  return distancia <= 1;
}

// ==========================================
// IDENTIFICAR MEDIDAS
// ==========================================

// Converte medidas para milímetros.
// Exemplo:
// 13 CM = 130 MM
// 4 MM = 4 MM
// 0,80 CM = 8 MM

function converterParaMM(valor, unidade) {
  const numero = Number(
    String(valor).replace(",", ".")
  );

  if (!Number.isFinite(numero)) return null;

  if (unidade === "M") return numero * 1000;
  if (unidade === "CM") return numero * 10;

  return numero;
}

function extrairMedidas(texto) {
  const original = normalizarTexto(texto);

  const medidas = new Set();

  const regex =
    /\b(\d+(?:[.,]\d+)?)\s*(MM|CM|M)\b/g;

  let resultado;

  while ((resultado = regex.exec(original)) !== null) {
    const valor = converterParaMM(
      resultado[1],
      resultado[2]
    );

    if (valor !== null) {
      medidas.add(Number(valor.toFixed(4)));
    }
  }

  return [...medidas];
}

function avaliarMedidas(busca, candidato) {
  const medidasBusca = extrairMedidas(busca);
  const medidasCandidato = extrairMedidas(candidato);

  if (medidasBusca.length === 0) {
    return {
      compativeis: null,
      cobertura: 1
    };
  }

  if (medidasCandidato.length === 0) {
    return {
      compativeis: null,
      cobertura: 0
    };
  }

  const correspondencias = medidasBusca.filter(medida =>
    medidasCandidato.includes(medida)
  );

  const cobertura =
    correspondencias.length / medidasBusca.length;

  return {
    compativeis: cobertura === 1,
    cobertura
  };
}

// ==========================================
// PESO DAS PALAVRAS
// ==========================================

function pesoToken(token) {
  // Material e especificações técnicas ajudam,
  // mas não devem impedir a localização do produto
  // quando a descrição comercial não contém esses dados.

  if ([
    "INOX", "AISI", "ACO",
    "CIRURGICO", "CIRURGICA"
  ].includes(token)) {
    return 0.55;
  }

  return 1;
}

// ==========================================
// SIMILARIDADE INTELIGENTE
// ==========================================

function calcularSimilaridade(busca, candidato) {
  const tokensBusca = [...new Set(obterTokens(busca))];

  const tokensNome = [
    ...new Set(obterTokens(candidato.produto))
  ];

  const tokensCatalogo = [
    ...new Set(
      obterTokens(
        `${candidato.produto} ${candidato.palavrasChave}`
      )
    )
  ];

  if (!tokensBusca.length || !tokensCatalogo.length) {
    return {
      score: 0,
      correspondencias: 0,
      coberturaNome: 0
    };
  }

  let pesoTotal = 0;
  let pesoCorrespondente = 0;
  let correspondencias = 0;
  let correspondenciasNome = 0;

  for (const tokenBusca of tokensBusca) {
    const peso = pesoToken(tokenBusca);

    pesoTotal += peso;

    const encontrado = tokensCatalogo.some(tokenCatalogo =>
      tokensParecidos(tokenBusca, tokenCatalogo)
    );

    if (encontrado) {
      pesoCorrespondente += peso;
      correspondencias++;

      const noNome = tokensNome.some(tokenNome =>
        tokensParecidos(tokenBusca, tokenNome)
      );

      if (noNome) {
        correspondenciasNome++;
      }
    }
  }

  const cobertura =
    pesoTotal > 0
      ? pesoCorrespondente / pesoTotal
      : 0;

  const coberturaNome =
    tokensBusca.length > 0
      ? correspondenciasNome / tokensBusca.length
      : 0;

  // O nome principal tem mais importância que palavras-chave.
  const score =
    (cobertura * 0.80) +
    (coberturaNome * 0.20);

  return {
    score,
    correspondencias,
    coberturaNome
  };
}

// ==========================================
// EXTRAIR REFERÊNCIA INFORMADA
// ==========================================

function extrairReferencia(texto) {
  const original = normalizarTexto(texto);

  const resultado = original.match(
    /\b(?:REF|REFERENCIA|CODIGO|COD)\s+([A-Z0-9]+(?:\s*[-/]\s*[A-Z0-9]+)*)/
  );

  if (!resultado) return null;

  return resultado[1].replace(/\s+/g, "");
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

  if (/^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(texto)) {
    texto = texto.replace(/,/g, "");
  } else if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+\.\d{1,2}$/.test(texto)) {
    // Mantém decimal com ponto.
  } else if (/^-?\d+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(",", ".");
  } else if (/^-?\d+$/.test(texto)) {
    // Mantém inteiro.
  } else {
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

  const produtos = linhas
    .slice(1)
    .filter(linha => linha[0] || linha[1])
    .map(montarProduto);

  // 1. REFERÊNCIA EXATA
  const referenciaInformada = extrairReferencia(produtoInformado);

  if (referenciaInformada) {
    const porReferencia = produtos.filter(item =>
      normalizarTexto(item.referencia).replace(/\s/g, "") ===
      referenciaInformada
    );

    if (porReferencia.length === 1) {
      return {
        tipo: "encontrado",
        produto: porReferencia[0],
        confianca: 1
      };
    }

    if (porReferencia.length > 1) {
      return {
        tipo: "ambiguo",
        candidatos: porReferencia.slice(0, 5)
      };
    }
  }

  // 2. REFERÊNCIA EXATA SEM TEXTO ADICIONAL
  const porReferenciaExata = produtos.filter(item =>
    normalizarTexto(item.referencia) === busca
  );

  if (porReferenciaExata.length === 1) {
    return {
      tipo: "encontrado",
      produto: porReferenciaExata[0],
      confianca: 1
    };
  }

  if (porReferenciaExata.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: porReferenciaExata.slice(0, 5)
    };
  }

  // 3. NOME EXATO
  const porNome = produtos.filter(item =>
    normalizarTexto(item.produto) === busca
  );

  if (porNome.length === 1) {
    return {
      tipo: "encontrado",
      produto: porNome[0],
      confianca: 1
    };
  }

  if (porNome.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: porNome.slice(0, 5)
    };
  }

  // 4. PALAVRA-CHAVE EXATA
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
      produto: porPalavraChave[0],
      confianca: 1
    };
  }

  if (porPalavraChave.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: porPalavraChave.slice(0, 5)
    };
  }

  // 5. SIMILARIDADE E CARACTERÍSTICAS
  const candidatos = produtos.map(item => {
    const textoCatalogo =
      `${item.produto} ${item.palavrasChave}`;

    const similaridade = calcularSimilaridade(
      produtoInformado,
      item
    );

    const medidas = avaliarMedidas(
      produtoInformado,
      textoCatalogo
    );

    let score = similaridade.score;

    // Medidas compatíveis aumentam a confiança.
    if (medidas.compativeis === true) {
      score += 0.10;
    }

    // Medidas explicitamente divergentes reduzem a confiança.
    if (medidas.compativeis === false) {
      score -= 0.25;
    }

    score = Math.max(0, Math.min(1, score));

    return {
      ...item,
      score,
      correspondencias: similaridade.correspondencias,
      medidasCompativeis: medidas.compativeis,
      coberturaMedidas: medidas.cobertura
    };
  });

  candidatos.sort((a, b) => b.score - a.score);

  // Não considera candidatos sem correspondência textual.
  const relevantes = candidatos.filter(item =>
    item.score >= 0.35 &&
    item.correspondencias >= 1
  );

  if (relevantes.length === 0) {
    return {
      tipo: "nao_encontrado"
    };
  }

  const melhor = relevantes[0];
  const segundo = relevantes[1];

  const diferenca = segundo
    ? melhor.score - segundo.score
    : 1;

  const quantidadeTokens = obterTokens(produtoInformado).length;

  // Aprovação automática conservadora.
  const altaConfianca =
    melhor.score >= 0.92 &&
    melhor.medidasCompativeis !== false &&
    quantidadeTokens >= 2 &&
    melhor.correspondencias >= 2 &&
    diferenca >= 0.12;

  if (altaConfianca) {
    return {
      tipo: "encontrado",
      produto: melhor,
      confianca: Number(melhor.score.toFixed(3))
    };
  }

  // 6. MÚLTIPLAS POSSIBILIDADES
  return {
    tipo: "ambiguo",
    candidatos: relevantes.slice(0, 5).map(item => ({
      referencia: item.referencia,
      produto: item.produto,
      score: Number(item.score.toFixed(3)),
      medidasCompativeis: item.medidasCompativeis
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

    // 1. VALIDAR CNPJ
    const cnpjValido = await validarCNPJ(sheets, cnpj);

    if (!cnpjValido) {
      return res.status(200).json({
        status: "cnpj_invalido",
        success: false,
        message: "CNPJ não encontrado no cadastro de clientes."
      });
    }

    // 2. IDENTIFICAR DDD
    const ddd = obterDDD(telefone);

    if (!ddd) {
      return res.status(200).json({
        status: "error",
        success: false,
        message: "Telefone inválido ou sem DDD."
      });
    }

    // 3. SELECIONAR PLANILHA REGIONAL
    const planilha = obterPlanilhaPorDDD(ddd);

    // 4. LER PLANILHA
    const linhas = await lerPlanilha(
      sheets,
      planilha.id,
      planilha.gid
    );

    // 5. BUSCAR PRODUTO
    const resultado = buscarProduto(
      linhas,
      produto
    );

    // PRODUTO NÃO ENCONTRADO
    if (resultado.tipo === "nao_encontrado") {
      return res.status(200).json({
        status: "not_found",
        success: false,
        produto,
        ddd,
        message: `Não localizei o produto: ${produto}.`
      });
    }

    // MÚLTIPLAS POSSIBILIDADES
    if (resultado.tipo === "ambiguo") {
      return res.status(200).json({
        status: "multiple_matches",
        success: false,
        produto_solicitado: produto,
        ddd,
        candidatos: resultado.candidatos.map(item => ({
          referencia: item.referencia,
          produto: item.produto,
          medidas_compativeis: item.medidasCompativeis,
          score: item.score
        })),
        message:
          "Encontrei possíveis produtos correspondentes. Apresente as opções ao cliente e solicite a confirmação antes de informar o preço."
      });
    }

    // PRODUTO ENCONTRADO
    const produtoEncontrado = resultado.produto;

    const precoFormatado = formatarPreco(
      produtoEncontrado.precoOriginal
    );

    const ipi = IPI_PADRAO;

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
