
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
// CONEXÃO GOOGLE
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
    .replace(/[×]/g, " X ")
    .replace(/[^\w\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Preserva números decimais para leitura técnica.
function normalizarCaracteristicas(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[×]/g, " X ")
    .replace(/[^\w.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// SINÔNIMOS
// ==========================================

const SINONIMOS = {
  BACKAUS: "BACKHAUS",
  BACKAUSS: "BACKHAUS",
  BACKHAUSS: "BACKHAUS",

  INOXIDAVEL: "INOX",
  INOXIDAVEIS: "INOX",
  ACOINOX: "INOX",

  METZEMBAUM: "METZENBAUM",

  HISTOMETRO: "HISTEROMETRO",

  YANKAUR: "YANKAUER",

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
  "FABRICADA", "CAPACIDADE",
  "FORMATO", "TIPO",
  "APROXIMADAMENTE", "APROX"
]);

function normalizarToken(token) {
  return SINONIMOS[token] || token;
}

function obterTokens(texto) {
  return normalizarTexto(texto)
    .split(" ")
    .map(normalizarToken)
    .filter(token => {
      if (!token || PALAVRAS_IGNORADAS.has(token)) {
        return false;
      }

      if (/^\d+$/.test(token)) {
        return false;
      }

      // Retira unidades e dimensões da comparação textual.
      if (/^\d+(?:\.\d+)?(?:MM|CM|ML|M|L)$/.test(token)) {
        return false;
      }

      return token !== "X";
    });
}

// ==========================================
// DISTÂNCIA DE LEVENSHTEIN
// ==========================================

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
// EXTRAÇÃO DE CARACTERÍSTICAS TÉCNICAS
// ==========================================

function converterParaMM(valor, unidade) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) return null;

  if (unidade === "M") return numero * 1000;
  if (unidade === "CM") return numero * 10;

  return numero;
}

function extrairCaracteristicas(texto) {
  const original = normalizarCaracteristicas(texto);

  const dimensoes = [];
  const medidasSimples = [];
  const capacidades = [];

  // Dimensões: 40X28CM, 40 X 28 CM.
  const regexDimensoes =
    /(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)\s*(MM|CM|M)\b/g;

  let resultado;

  while ((resultado = regexDimensoes.exec(original)) !== null) {
    const unidade = resultado[3];

    const fator =
      unidade === "M" ? 1000 :
      unidade === "CM" ? 10 : 1;

    const a = Number(resultado[1]) * fator;
    const b = Number(resultado[2]) * fator;

    dimensoes.push(
      [
        Number(a.toFixed(4)),
        Number(b.toFixed(4))
      ].sort((x, y) => x - y)
    );
  }

  const semDimensoes = original.replace(
    regexDimensoes,
    " "
  );

  // Medidas individuais: 13CM, 15CM, 4MM.
  const regexMedidas =
    /\b(\d+(?:\.\d+)?)\s*(MM|CM|M)\b/g;

  while ((resultado = regexMedidas.exec(semDimensoes)) !== null) {
    const valor = converterParaMM(
      resultado[1],
      resultado[2]
    );

    if (valor !== null) {
      medidasSimples.push(
        Number(valor.toFixed(4))
      );
    }
  }

  // Capacidade: 2000ML, 3500ML, 2L.
  const regexCapacidade =
    /\b(\d+(?:\.\d+)?)\s*(ML|LITROS?|L)\b/g;

  while ((resultado = regexCapacidade.exec(original)) !== null) {
    let valor = Number(resultado[1]);

    if (resultado[2] !== "ML") {
      valor *= 1000;
    }

    capacidades.push(
      Number(valor.toFixed(4))
    );
  }

  return {
    dimensoes,
    medidasSimples: [...new Set(medidasSimples)],
    capacidades: [...new Set(capacidades)]
  };
}

// ==========================================
// COMPARAÇÃO DE CARACTERÍSTICAS
// ==========================================

function avaliarCaracteristicas(busca, candidato) {
  const solicitadas = extrairCaracteristicas(busca);
  const cadastradas = extrairCaracteristicas(candidato);

  const resultado = {
    medidasCompativeis: null,
    dimensoesCompativeis: null,
    capacidadesCompativeis: null
  };

  if (solicitadas.medidasSimples.length) {
    resultado.medidasCompativeis =
      cadastradas.medidasSimples.length
        ? solicitadas.medidasSimples.every(medida =>
            cadastradas.medidasSimples.includes(medida)
          )
        : null;
  }

  if (solicitadas.dimensoes.length) {
    resultado.dimensoesCompativeis =
      cadastradas.dimensoes.length
        ? solicitadas.dimensoes.every(dimensao =>
            cadastradas.dimensoes.some(cadastrada =>
              dimensao[0] === cadastrada[0] &&
              dimensao[1] === cadastrada[1]
            )
          )
        : null;
  }

  if (solicitadas.capacidades.length) {
    resultado.capacidadesCompativeis =
      cadastradas.capacidades.length
        ? solicitadas.capacidades.every(capacidade =>
            cadastradas.capacidades.includes(capacidade)
          )
        : null;
  }

  const verificacoes = Object.values(resultado)
    .filter(valor => valor !== null);

  const compativeis = verificacoes.length
    ? verificacoes.every(Boolean)
    : null;

  return {
    ...resultado,
    compativeis,
    possuiCaracteristicaNaoInformada:
      Object.values(resultado).some(valor => valor === null)
  };
}

// ==========================================
// ATRIBUTOS IMPORTANTES
// ==========================================

// Se o cliente especificar um atributo, ele precisa
// estar confirmado no cadastro para liberar o preço.

const GRUPOS_ATRIBUTOS = [
  {
    nome: "formato",
    opcoes: ["RETA", "CURVA"]
  },
  {
    nome: "perfuracao",
    opcoes: ["NAO PERFURANTE", "PERFURANTE"]
  },
  {
    nome: "material",
    opcoes: ["INOX", "ACO CARBONO"]
  },
  {
    nome: "bolinha",
    opcoes: ["COM BOLINHA", "SEM BOLINHA"]
  }
];

function normalizarParaAtributo(texto) {
  return normalizarCaracteristicas(texto)
    .replace(/\bACO INOXIDAVEL\b/g, "INOX")
    .replace(/\bACO INOX\b/g, "INOX")
    .replace(/\bACO CARBONO\b/g, "ACO CARBONO");
}

function avaliarAtributos(busca, candidato) {
  const textoBusca = normalizarParaAtributo(busca);
  const textoCandidato = normalizarParaAtributo(candidato);

  const divergencias = [];
  const naoConfirmados = [];

  for (const grupo of GRUPOS_ATRIBUTOS) {
    const atributoSolicitado = grupo.opcoes.find(opcao =>
      textoBusca.includes(opcao)
    );

    if (!atributoSolicitado) continue;

    const atributoCadastrado = grupo.opcoes.find(opcao =>
      textoCandidato.includes(opcao)
    );

    if (!atributoCadastrado) {
      naoConfirmados.push(grupo.nome);
      continue;
    }

    if (atributoSolicitado !== atributoCadastrado) {
      divergencias.push(grupo.nome);
    }
  }

  return {
    compativel: divergencias.length === 0,
    divergencias,
    naoConfirmados
  };
}

// ==========================================
// PESO DAS PALAVRAS
// ==========================================

function pesoToken(token) {
  if ([
    "INOX", "AISI", "ACO",
    "CIRURGICO", "CIRURGICA"
  ].includes(token)) {
    return 0.65;
  }

  return 1;
}

// ==========================================
// SIMILARIDADE
// ==========================================

function calcularSimilaridade(busca, candidato) {
  const tokensBusca = [...new Set(obterTokens(busca))];

  const tokensNome = [
    ...new Set(obterTokens(candidato.produto))
  ];

  const tokensKeywords = [
    ...new Set(obterTokens(candidato.palavrasChave))
  ];

  if (!tokensBusca.length) {
    return {
      score: 0,
      correspondencias: 0,
      coberturaNome: 0,
      coberturaPalavrasChave: 0
    };
  }

  let pesoTotal = 0;
  let pesoCorrespondente = 0;
  let correspondencias = 0;
  let correspondenciasNome = 0;
  let correspondenciasKeyword = 0;

  for (const tokenBusca of tokensBusca) {
    const peso = pesoToken(tokenBusca);

    pesoTotal += peso;

    const noNome = tokensNome.some(token =>
      tokensParecidos(tokenBusca, token)
    );

    const naKeyword = tokensKeywords.some(token =>
      tokensParecidos(tokenBusca, token)
    );

    if (noNome || naKeyword) {
      pesoCorrespondente += peso;
      correspondencias++;
    }

    if (noNome) correspondenciasNome++;
    if (naKeyword) correspondenciasKeyword++;
  }

  const cobertura = pesoTotal
    ? pesoCorrespondente / pesoTotal
    : 0;

  const coberturaNome =
    correspondenciasNome / tokensBusca.length;

  const coberturaPalavrasChave =
    correspondenciasKeyword / tokensBusca.length;

  const score =
    cobertura * 0.65 +
    coberturaNome * 0.20 +
    coberturaPalavrasChave * 0.15;

  return {
    score,
    correspondencias,
    coberturaNome,
    coberturaPalavrasChave
  };
}

// ==========================================
// EXTRAIR REFERÊNCIA
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
// PREÇOS
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
    // Decimal com ponto.
  } else if (/^-?\d+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(",", ".");
  } else if (!/^-?\d+$/.test(texto)) {
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
// AVALIAR CANDIDATO
// ==========================================

function avaliarCandidato(produtoInformado, item) {
  const textoCatalogo =
    `${item.produto} ${item.palavrasChave}`;

  const similaridade = calcularSimilaridade(
    produtoInformado,
    item
  );

  const caracteristicas = avaliarCaracteristicas(
    produtoInformado,
    textoCatalogo
  );

  const atributos = avaliarAtributos(
    produtoInformado,
    textoCatalogo
  );

  let score = similaridade.score;

  if (caracteristicas.compativeis === true) {
    score += 0.08;
  }

  if (caracteristicas.compativeis === false) {
    score -= 0.35;
  }

  if (!atributos.compativel) {
    score -= 0.35;
  }

  if (atributos.naoConfirmados.length) {
    score -= 0.08 * atributos.naoConfirmados.length;
  }

  score = Math.max(0, Math.min(1, score));

  const possuiCaracteristicaNaoInformada =
    caracteristicas.possuiCaracteristicaNaoInformada ||
    atributos.naoConfirmados.length > 0;

  const possuiDivergencia =
    caracteristicas.compativeis === false ||
    atributos.divergencias.length > 0;

  return {
    ...item,
    score,
    correspondencias: similaridade.correspondencias,
    medidasCompativeis: caracteristicas.compativeis,
    dimensoesCompativeis:
      caracteristicas.dimensoesCompativeis,
    capacidadesCompativeis:
      caracteristicas.capacidadesCompativeis,
    possuiCaracteristicaNaoInformada,
    possuiDivergencia,
    atributosNaoConfirmados: atributos.naoConfirmados,
    atributosDivergentes: atributos.divergencias
  };
}

// ==========================================
// BUSCA DE PRODUTOS
// ==========================================

function buscarProduto(linhas, produtoInformado) {
  const busca = normalizarTexto(produtoInformado);

  if (!busca) {
    return { tipo: "nao_encontrado" };
  }

  const produtos = linhas
    .slice(1)
    .filter(linha => linha[0] || linha[1])
    .map(montarProduto);

  // 1. REFERÊNCIA EXPLÍCITA

  const referenciaInformada = extrairReferencia(
    produtoInformado
  );

  if (referenciaInformada) {
    const encontrados = produtos.filter(item =>
      normalizarTexto(item.referencia).replace(/\s/g, "") ===
      referenciaInformada
    );

    if (encontrados.length === 1) {
      return {
        tipo: "encontrado",
        produto: encontrados[0],
        confianca: 1
      };
    }

    if (encontrados.length > 1) {
      return {
        tipo: "ambiguo",
        candidatos: encontrados.slice(0, 5).map(item =>
          avaliarCandidato(produtoInformado, item)
        )
      };
    }
  }

  // 2. REFERÊNCIA ISOLADA

  const porReferencia = produtos.filter(item =>
    normalizarTexto(item.referencia).replace(/\s/g, "") ===
    busca.replace(/\s/g, "")
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
      candidatos: porReferencia.slice(0, 5).map(item =>
        avaliarCandidato(produtoInformado, item)
      )
    };
  }

  // 3. NOME EXATO OU PALAVRA-CHAVE EXATA

  const tokensBusca = obterTokens(produtoInformado).join(" ");

  const exatos = produtos.filter(item => {
    const nome = obterTokens(item.produto).join(" ");
    const keyword = obterTokens(item.palavrasChave).join(" ");

    return (
      (nome && nome === tokensBusca) ||
      (keyword && keyword === tokensBusca)
    );
  });

  if (exatos.length === 1) {
    const avaliado = avaliarCandidato(
      produtoInformado,
      exatos[0]
    );

    if (
      !avaliado.possuiDivergencia &&
      !avaliado.possuiCaracteristicaNaoInformada
    ) {
      return {
        tipo: "encontrado",
        produto: exatos[0],
        confianca: 1
      };
    }

    return {
      tipo: "ambiguo",
      candidatos: [avaliado]
    };
  }

  if (exatos.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: exatos.slice(0, 5).map(item =>
        avaliarCandidato(produtoInformado, item)
      )
    };
  }

  // 4. BUSCA POR SIMILARIDADE

  const candidatos = produtos.map(item =>
    avaliarCandidato(produtoInformado, item)
  );

  candidatos.sort((a, b) => b.score - a.score);

  const relevantes = candidatos.filter(item =>
    item.score >= 0.30 &&
    item.correspondencias >= 1
  );

  if (!relevantes.length) {
    return { tipo: "nao_encontrado" };
  }

  const melhor = relevantes[0];
  const segundo = relevantes[1];

  const diferenca = segundo
    ? melhor.score - segundo.score
    : 1;

  const quantidadeTokens = obterTokens(produtoInformado).length;

  // 5. APROVAÇÃO AUTOMÁTICA CONSERVADORA

  const altaConfianca =
    melhor.score >= 0.92 &&
    !melhor.possuiDivergencia &&
    !melhor.possuiCaracteristicaNaoInformada &&
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
    candidatos: relevantes.slice(0, 5)
  };
}

// ==========================================
// FORMATAR CANDIDATOS PARA A API
// ==========================================

function formatarCandidatos(candidatos) {
  return candidatos.map(item => ({
    referencia: item.referencia,
    produto: item.produto,
    medidas_compativeis: item.medidasCompativeis,
    dimensoes_compativeis: item.dimensoesCompativeis,
    capacidades_compativeis: item.capacidadesCompativeis,
    score: Number(item.score.toFixed(3))
  }));
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
    // resultado é declarado aqui, antes de ser utilizado.

    const resultado = buscarProduto(
      linhas,
      produto
    );

    // 6. PRODUTO NÃO ENCONTRADO

    if (resultado.tipo === "nao_encontrado") {
      return res.status(200).json({
        status: "not_found",
        success: false,
        produto,
        ddd,
        message: `Não localizei o produto: ${produto}.`
      });
    }

    // 7. MÚLTIPLAS POSSIBILIDADES

    if (resultado.tipo === "ambiguo") {
      return res.status(200).json({
        status: "multiple_matches",
        success: false,
        produto_solicitado: produto,
        ddd,
        candidatos: formatarCandidatos(
          resultado.candidatos
        ),
        message:
          "Encontrei possíveis produtos correspondentes. Apresente as opções ao cliente e solicite a confirmação antes de informar o preço."
      });
    }

    // 8. PRODUTO ENCONTRADO

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
      erro.stack || erro.message
    );

    return res.status(500).json({
      status: "error",
      success: false,
      message:
        "Ocorreu um erro ao consultar o produto. Encaminhe para atendimento humano."
    });
  }
};
